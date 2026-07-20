// lib/entrySandbox.js

const SANDBOX_FUNCTIONS = [
    'addLoreEntries', 'addWorldEntries', 'addSubLocationEntry',
    'buildRosterEntry', 'buildLocationsEntry', 'cleanKeywords',
    'addBoilerplateProperties', 'buildLoreOutfitSection',
    'parseCharacterOutfitEntries', 'parseLocationSubLocations',
];

// Loads the target script via a classic <script src> tag rather than
// fetch()+eval(). This is deliberate, not a style choice: this runner
// document executes in a sandboxed iframe WITHOUT allow-same-origin, so it
// has a unique opaque origin ("null"). A fetch() of a cross-origin script is
// subject to the CORS same-origin check and requires the response to carry
// an Access-Control-Allow-Origin header -- confirmed (via direct curl against
// the live Registrar) that base.js's response has no such header, so
// fetch().then(text => eval(text)) reliably fails with a CORS error in this
// exact sandbox. Classic <script src> element loading is a plain subresource
// fetch (like an <img> or stylesheet), not gated by CORS at all -- the script
// executes normally even though its response body is opaque to us, which is
// exactly what's needed here (we only need its side effect of defining
// window-level functions, never need to read its source as a string).
const RUNNER_HTML = `<!DOCTYPE html><html><head></head><body><script>
    window.addEventListener('message', async (event) => {
        const { id, type, payload } = event.data || {};
        if (type === 'load') {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = payload.scriptUrl;
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error('Failed to load script: ' + payload.scriptUrl));
                    document.body.appendChild(script);
                });
                const missing = payload.expectedFunctions.filter(name => typeof window[name] !== 'function');
                if (missing.length) {
                    parent.postMessage({ id, type: 'load-error', error: 'Missing functions: ' + missing.join(', ') }, '*');
                    return;
                }
                parent.postMessage({ id, type: 'load-ok' }, '*');
            } catch (error) {
                parent.postMessage({ id, type: 'load-error', error: String(error) }, '*');
            }
            return;
        }
        if (type === 'call') {
            try {
                const fn = window[payload.name];
                if (typeof fn !== 'function') throw new Error('Not a function: ' + payload.name);
                const result = await fn(...payload.args);
                parent.postMessage({ id, type: 'call-ok', result }, '*');
            } catch (error) {
                parent.postMessage({ id, type: 'call-error', error: String(error) }, '*');
            }
        }
    });
</script></body></html>`;

/**
 * Loads the Registrar's own base.js into a hidden, permission-stripped iframe
 * (sandbox="allow-scripts" WITHOUT allow-same-origin, so it runs in a unique
 * opaque origin with no access to SillyTavern's DOM, cookies, localStorage, or
 * session) and exposes its pure entry-building functions via postMessage RPC.
 * @param {string} baseUrl - Registrar base URL, e.g. "https://registrar.weybooru.com"
 * @returns {Promise<{callFunction: (name: string, args: any[]) => Promise<any>, destroy: () => void}>}
 */
export async function createEntrySandbox(baseUrl) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.display = 'none';
    iframe.srcdoc = RUNNER_HTML;
    document.body.appendChild(iframe);

    await new Promise((resolve) => {
        iframe.addEventListener('load', resolve, { once: true });
    });

    let nextId = 1;
    const pending = new Map();

    function onMessage(event) {
        if (event.source !== iframe.contentWindow) return;
        const { id, type, result, error } = event.data || {};
        const waiter = pending.get(id);
        if (!waiter) return;
        pending.delete(id);
        if (type === 'call-error' || type === 'load-error') {
            waiter.reject(new Error(error));
        } else {
            waiter.resolve(result);
        }
    }
    window.addEventListener('message', onMessage);

    function send(type, payload) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            iframe.contentWindow.postMessage({ id, type, payload }, '*');
        });
    }

    function destroy() {
        window.removeEventListener('message', onMessage);
        iframe.remove();
    }

    try {
        await send('load', {
            scriptUrl: `${baseUrl}/base.js`,
            expectedFunctions: SANDBOX_FUNCTIONS,
        });
    } catch (error) {
        // Don't leave a dead hidden iframe (and its message listener) behind
        // on a failed load -- nobody else holds a reference to clean it up.
        destroy();
        throw error;
    }

    return {
        callFunction: (name, args) => send('call', { name, args }),
        destroy,
    };
}
