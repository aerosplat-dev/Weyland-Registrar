// lib/ui/collectionForm.js
import { parseSearchTerms, matchesTerms } from '../filterQuery.js';

/**
 * @typedef {Object} CollectionFormState
 * @property {'create'|'rename'|'members'} mode
 * @property {string} [existingId] - present for rename/members modes
 * @property {string} [initialName]
 * @property {string[]} [initialMemberKeys]
 * @property {Array<{itemKey: string, name: string, kind: 'character'|'location', searchBlob?: object}>} availableItems - every character/location currently in the catalog, for the member checklist
 * @property {(itemKey: string) => boolean} [resolveActive] - used by the "Select Active Items" button (create mode only)
 */

/**
 * Renders the local-set create/rename/edit-members form. All three modes
 * share one component: "create" and "members" both show the member
 * checklist (with its own search + category filter, since the combined
 * character+location catalog is too large to browse unfiltered), "rename"
 * only shows the name field.
 *
 * The member checklist's checked state is tracked in `checkedKeys`, a Set
 * kept independent of which checkbox DOM elements currently exist --
 * search/category filtering only changes which items are *visible*, not
 * which are *checked*, so a member checked while filtered to "Locations"
 * stays checked after switching the filter back to "Characters".
 * @param {HTMLElement} container
 * @param {CollectionFormState} formState
 * @param {{onSubmit: (result: {name?: string, memberKeys?: string[]}) => void, onCancel: () => void}} handlers
 */
export function renderCollectionForm(container, formState, handlers) {
    container.innerHTML = '';

    const showName = formState.mode === 'create' || formState.mode === 'rename';
    const showMembers = formState.mode === 'create' || formState.mode === 'members';

    const heading = document.createElement('div');
    heading.className = 'wreg-detail-title';
    heading.textContent = formState.mode === 'create' ? 'New Local Set'
        : formState.mode === 'rename' ? 'Rename Set'
        : 'Edit Members';
    container.appendChild(heading);

    let nameInput = null;
    if (showName) {
        const field = document.createElement('div');
        field.className = 'wreg-form-field';
        const label = document.createElement('label');
        label.textContent = 'Name';
        nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = formState.initialName ?? '';
        field.appendChild(label);
        field.appendChild(nameInput);
        container.appendChild(field);
    }

    const checkedKeys = new Set(formState.initialMemberKeys ?? []);
    let renderMemberChecklist = () => {};

    if (showMembers) {
        // The "Members" heading label is kept in its own `.wreg-form-field`
        // wrapper, with the search/category controls and the checklist
        // appended as *siblings* afterward rather than nested inside that
        // same wrapper. `.wreg-form-field label` (specificity 0,1,1) styles
        // any descendant `<label>`, so if the per-item
        // `<label class="wreg-item-row">` rows below were nested inside this
        // wrapper too, that selector would beat `.wreg-item-row`
        // (specificity 0,1,0) and clobber every row's `display: flex` with
        // `display: block` (plus the small/uppercase/muted field-label text
        // styling) -- breaking the checkbox+title layout of every row in the
        // list.
        const labelField = document.createElement('div');
        labelField.className = 'wreg-form-field';
        const label = document.createElement('label');
        label.textContent = 'Members';
        labelField.appendChild(label);
        container.appendChild(labelField);

        const controls = document.createElement('div');
        controls.className = 'wreg-form-member-controls';

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'wreg-search';
        search.placeholder = 'Search... (species:neko owner:name)';
        controls.appendChild(search);

        const category = document.createElement('select');
        category.className = 'wreg-sort-select';
        category.title = 'Filter by category';
        for (const [value, text] of [['all', 'All'], ['character', 'Characters'], ['location', 'Locations']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            category.appendChild(option);
        }
        controls.appendChild(category);

        // "Select Active Items" only makes sense when starting a brand new
        // set from your current roster -- create mode only, per spec.
        let selectActiveBtn = null;
        if (formState.mode === 'create' && formState.resolveActive) {
            selectActiveBtn = document.createElement('button');
            selectActiveBtn.type = 'button';
            selectActiveBtn.className = 'wreg-btn-icon wreg-btn-text';
            selectActiveBtn.textContent = 'Select Active Items';
            controls.appendChild(selectActiveBtn);
        }

        container.appendChild(controls);

        const list = document.createElement('div');
        list.className = 'wreg-item-list';
        container.appendChild(list);

        renderMemberChecklist = () => {
            list.innerHTML = '';
            const terms = parseSearchTerms(search.value);
            const categoryValue = category.value;
            const filtered = formState.availableItems.filter((item) => {
                if (categoryValue !== 'all' && item.kind !== categoryValue) return false;
                if (terms.length) {
                    if (!item.searchBlob) return true; // no blob to filter against -- don't hide it
                    return matchesTerms(item.searchBlob, terms);
                }
                return true;
            });
            for (const item of filtered) {
                const row = document.createElement('label');
                row.className = 'wreg-item-row';
                row.style.cursor = 'pointer';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = checkedKeys.has(item.itemKey);
                checkbox.style.marginRight = '8px';
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) checkedKeys.add(item.itemKey);
                    else checkedKeys.delete(item.itemKey);
                });
                const name = document.createElement('span');
                name.className = 'wreg-item-title';
                name.textContent = item.name;
                row.appendChild(checkbox);
                row.appendChild(name);
                list.appendChild(row);
            }
        };

        search.addEventListener('input', renderMemberChecklist);
        category.addEventListener('change', renderMemberChecklist);
        selectActiveBtn?.addEventListener('click', () => {
            // Adds to the current selection rather than replacing it, so
            // this is safe to click alongside manual picks (and idempotent
            // if clicked more than once) instead of silently discarding
            // items already checked by hand.
            for (const item of formState.availableItems) {
                if (formState.resolveActive(item.itemKey)) checkedKeys.add(item.itemKey);
            }
            renderMemberChecklist();
        });

        renderMemberChecklist();
    }

    const actions = document.createElement('div');
    actions.className = 'wreg-detail-actions';

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'wreg-btn-primary';
    submit.textContent = 'Save';
    submit.addEventListener('click', () => {
        const result = {};
        if (nameInput) {
            const trimmed = nameInput.value.trim();
            if (!trimmed) {
                nameInput.focus();
                return;
            }
            result.name = trimmed;
        }
        // Gate on the mode (`showMembers`), not on `checkedKeys.size`: an
        // empty selection is a legitimate explicit choice (e.g. a brand new
        // set the user hasn't picked members for yet), and a size-based
        // check would wrongly omit `memberKeys` from the result instead of
        // reporting that explicit empty selection.
        if (showMembers) {
            result.memberKeys = [...checkedKeys];
        }
        handlers.onSubmit(result);
    });
    actions.appendChild(submit);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wreg-btn-icon';
    cancel.textContent = 'Cancel';
    cancel.style.width = 'auto';
    cancel.style.padding = '0 10px';
    cancel.addEventListener('click', () => handlers.onCancel());
    actions.appendChild(cancel);

    container.appendChild(actions);
}
