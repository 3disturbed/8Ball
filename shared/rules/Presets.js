// Rule presets the host picks from, plus individual toggles (SDD §3).

export const PRESETS = {
  casual: {
    railAfterContact: false,
    callPocket: 'none',
    scratchOnEightLoss: false,
    breakRequirement: 'none',
    turnTimer: 0,
    guideline: 'full',
    bestOf: 1,
  },
  standard: {
    railAfterContact: true,
    callPocket: 'eight',
    scratchOnEightLoss: true,
    breakRequirement: 'fourRails',
    turnTimer: 30,
    guideline: 'short',
    bestOf: 1,
  },
  pro: {
    railAfterContact: true,
    callPocket: 'all',
    scratchOnEightLoss: true,
    breakRequirement: 'fourRails',
    turnTimer: 15,
    guideline: 'off',
    bestOf: 1,
  },
};

const VALID = {
  railAfterContact: [true, false],
  callPocket: ['none', 'eight', 'all'],
  scratchOnEightLoss: [true, false],
  breakRequirement: ['none', 'fourRails'],
  turnTimer: [0, 15, 30],
  guideline: ['full', 'short', 'off'],
  bestOf: [1, 3, 5],
};

export function makeConfig(preset = 'standard', overrides = {}) {
  const base = PRESETS[preset] || PRESETS.standard;
  const config = { ...base, preset: PRESETS[preset] ? preset : 'standard' };
  for (const [key, values] of Object.entries(VALID)) {
    if (key in overrides && values.includes(overrides[key])) config[key] = overrides[key];
  }
  return config;
}
