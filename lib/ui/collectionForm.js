// lib/ui/collectionForm.js

/**
 * @typedef {Object} CollectionFormState
 * @property {'create'|'rename'|'members'} mode
 * @property {string} [existingId] - present for rename/members modes
 * @property {string} [initialName]
 * @property {string[]} [initialMemberKeys]
 * @property {Array<{itemKey: string, name: string}>} availableItems - every character/location currently in the catalog, for the member checklist
 */

/**
 * Renders the local-collection create/rename/edit-members form. All three
 * modes share one component: "create" and "members" both show the member
 * checklist, "rename" only shows the name field.
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
    heading.textContent = formState.mode === 'create' ? 'New Local Collection'
        : formState.mode === 'rename' ? 'Rename Collection'
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

    const checkboxes = new Map();
    if (showMembers) {
        const initialMembers = new Set(formState.initialMemberKeys ?? []);

        // The "Members" heading label is kept in its own `.wreg-form-field`
        // wrapper, with the checklist appended as a *sibling* afterward
        // rather than nested inside that same wrapper. `.wreg-form-field
        // label` (specificity 0,1,1) styles any descendant `<label>`, so if
        // the per-item `<label class="wreg-item-row">` rows below were
        // nested inside this wrapper too, that selector would beat
        // `.wreg-item-row` (specificity 0,1,0) and clobber every row's
        // `display: flex` with `display: block` (plus the small/uppercase/
        // muted field-label text styling) -- breaking the checkbox+title
        // layout of every row in the list.
        const labelField = document.createElement('div');
        labelField.className = 'wreg-form-field';
        const label = document.createElement('label');
        label.textContent = 'Members';
        labelField.appendChild(label);
        container.appendChild(labelField);

        const list = document.createElement('div');
        list.className = 'wreg-item-list';
        for (const item of formState.availableItems) {
            const row = document.createElement('label');
            row.className = 'wreg-item-row';
            row.style.cursor = 'pointer';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = initialMembers.has(item.itemKey);
            checkbox.style.marginRight = '8px';
            checkboxes.set(item.itemKey, checkbox);
            const name = document.createElement('span');
            name.className = 'wreg-item-title';
            name.textContent = item.name;
            row.appendChild(checkbox);
            row.appendChild(name);
            list.appendChild(row);
        }
        container.appendChild(list);
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
        // Gate on the mode (`showMembers`), not on `checkboxes.size`: an
        // empty catalog would leave the Map empty even in 'create'/'members'
        // mode, and a size-based check would then wrongly omit `memberKeys`
        // from the result instead of reporting an explicit empty selection.
        if (showMembers) {
            result.memberKeys = [...checkboxes.entries()].filter(([, cb]) => cb.checked).map(([key]) => key);
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
