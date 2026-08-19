// Host rules picker (SDD §3): preset base + individual toggles.
// Returns a promise resolving to { preset, overrides } or null on cancel.

import { PRESETS } from '/shared/rules/Presets.js';

export function rulesDialog(container, { title = 'Table rules', confirmLabel = 'Create table' } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'rules-modal';
    el.innerHTML = `
      <div class="rules-card">
        <h2>${title}</h2>
        <div class="rules-row rules-presets">
          <button data-preset="casual">Casual</button>
          <button data-preset="standard" class="sel">Standard</button>
          <button data-preset="pro">Pro</button>
        </div>
        <label class="rules-row">Shot clock
          <select name="turnTimer">
            <option value="0">Off</option><option value="30">30s</option><option value="15">15s</option>
          </select></label>
        <label class="rules-row">Aiming guide
          <select name="guideline">
            <option value="full">Full</option><option value="short">Short</option><option value="off">Off</option>
          </select></label>
        <label class="rules-row">Call pockets
          <select name="callPocket">
            <option value="none">Never</option><option value="eight">The 8 only</option><option value="all">Every shot</option>
          </select></label>
        <label class="rules-row">Race length
          <select name="bestOf">
            <option value="1">Single rack</option><option value="3">Best of 3</option><option value="5">Best of 5</option>
          </select></label>
        <label class="rules-row rules-check"><input type="checkbox" name="railAfterContact"> Rail required after contact</label>
        <label class="rules-row rules-check"><input type="checkbox" name="scratchOnEightLoss"> Bad 8-ball shot loses the rack</label>
        <div class="rules-actions">
          <button class="rules-cancel">Cancel</button>
          <button class="rules-ok">${confirmLabel}</button>
        </div>
      </div>`;
    container.appendChild(el);

    let preset = 'standard';
    const fields = el.querySelectorAll('select, input[type="checkbox"]');

    function loadPreset(name) {
      preset = name;
      const p = PRESETS[name];
      for (const b of el.querySelectorAll('[data-preset]')) {
        b.classList.toggle('sel', b.dataset.preset === name);
      }
      el.querySelector('[name="turnTimer"]').value = String(p.turnTimer);
      el.querySelector('[name="guideline"]').value = p.guideline;
      el.querySelector('[name="callPocket"]').value = p.callPocket;
      el.querySelector('[name="bestOf"]').value = String(p.bestOf);
      el.querySelector('[name="railAfterContact"]').checked = p.railAfterContact;
      el.querySelector('[name="scratchOnEightLoss"]').checked = p.scratchOnEightLoss;
    }
    loadPreset('standard');

    for (const b of el.querySelectorAll('[data-preset]')) {
      b.addEventListener('click', () => loadPreset(b.dataset.preset));
    }

    function done(value) {
      el.remove();
      resolve(value);
    }
    el.querySelector('.rules-cancel').addEventListener('click', () => done(null));
    el.addEventListener('click', (e) => { if (e.target === el) done(null); });
    el.querySelector('.rules-ok').addEventListener('click', () => {
      const overrides = {};
      for (const f of fields) {
        if (f.type === 'checkbox') overrides[f.name] = f.checked;
        else overrides[f.name] = f.name === 'guideline' || f.name === 'callPocket' ? f.value : Number(f.value);
      }
      done({ preset, overrides });
    });
  });
}
