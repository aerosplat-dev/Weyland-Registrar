/**
 * Derives this extension's own SillyTavern-relative base path (e.g.
 * "third-party/Weyland-Registrar" or "Weyland-Registrar") from a module's
 * import.meta.url, regardless of how deeply nested that module is under lib/.
 * @param {string} metaUrl - import.meta.url of any module inside this extension
 * @returns {string}
 */
export function resolveExtensionBasePath(metaUrl) {
    const url = new URL(metaUrl);
    const match = url.pathname.match(/^\/scripts\/extensions\/((?:third-party\/)?Weyland-Registrar)\//);
    if (!match) {
        throw new Error(`Could not resolve Weyland-Registrar base path from: ${url.pathname}`);
    }
    return match[1];
}
