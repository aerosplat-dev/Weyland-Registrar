// lib/ui/detailPane.js
import { buildDetailFields } from './detailFields.js';

/**
 * @typedef {Object} ItemDetail
 * @property {string} itemKey
 * @property {'character'|'location'|'collection'|'lore'|'local'} kind
 * @property {object} record - raw catalog record (character/location/collection/lore) or {name} for a local collection
 * @property {boolean} isActive
 * @property {'none'|'active'|'inactive'} forced
 * @property {string[]} [memberNames] - for collection/local kinds: resolved member display names
 * @property {boolean} [isLocal] - true only for a local collection, to show rename/edit/delete controls
 */

/**
 * Renders the curated detail view for one item into container.
 * @param {HTMLElement} container
 * @param {ItemDetail} detail
 * @param {{
 *   onActivate: (itemKey: string) => void,
 *   onDeactivate: (itemKey: string) => void,
 *   onRenameLocalCollection?: (itemKey: string) => void,
 *   onEditLocalCollectionMembers?: (itemKey: string) => void,
 *   onDeleteLocalCollection?: (itemKey: string) => void,
 * }} handlers
 */
export function renderDetailPane(container, detail, handlers) {
    container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'wreg-detail-title';
    title.textContent = detail.record.name;
    container.appendChild(title);

    if (detail.record.portrait) {
        const img = document.createElement('img');
        img.className = 'wreg-detail-portrait';
        img.src = detail.record.portrait;
        img.alt = detail.record.name;
        container.appendChild(img);
    }

    if (detail.record.summary) {
        appendField(container, 'Summary', detail.record.summary);
    }

    for (const field of buildDetailFields(detail.record, detail.kind)) {
        appendField(container, field.label, field.value);
    }

    if (detail.memberNames && detail.memberNames.length) {
        appendField(container, 'Members', detail.memberNames.join(', '));
    }

    const actions = document.createElement('div');
    actions.className = 'wreg-detail-actions';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wreg-btn-primary';
    toggle.textContent = detail.isActive ? 'Deactivate' : 'Activate';
    toggle.addEventListener('click', () => {
        if (detail.isActive) handlers.onDeactivate(detail.itemKey);
        else handlers.onActivate(detail.itemKey);
    });
    actions.appendChild(toggle);

    if (detail.isLocal) {
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'wreg-btn-icon';
        rename.textContent = 'Rename';
        rename.style.width = 'auto';
        rename.style.padding = '0 10px';
        rename.addEventListener('click', () => handlers.onRenameLocalCollection?.(detail.itemKey));
        actions.appendChild(rename);

        const editMembers = document.createElement('button');
        editMembers.type = 'button';
        editMembers.className = 'wreg-btn-icon';
        editMembers.textContent = 'Edit Members';
        editMembers.style.width = 'auto';
        editMembers.style.padding = '0 10px';
        editMembers.addEventListener('click', () => handlers.onEditLocalCollectionMembers?.(detail.itemKey));
        actions.appendChild(editMembers);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'wreg-btn-icon';
        del.textContent = 'Delete';
        del.style.width = 'auto';
        del.style.padding = '0 10px';
        del.addEventListener('click', () => {
            if (window.confirm(`Delete the local collection "${detail.record.name}"? This cannot be undone.`)) {
                handlers.onDeleteLocalCollection?.(detail.itemKey);
            }
        });
        actions.appendChild(del);
    }

    container.appendChild(actions);
}

function appendField(container, label, value) {
    const field = document.createElement('div');
    field.className = 'wreg-detail-field';
    const labelEl = document.createElement('div');
    labelEl.className = 'wreg-detail-field-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'wreg-detail-field-value';
    valueEl.textContent = value;
    field.appendChild(labelEl);
    field.appendChild(valueEl);
    container.appendChild(field);
}
