// Every tuning knob in the game lives here. Values marked "knob" get tuned in
// the M1 sandbox; everything downstream (rules, netcode, AI) reads from here.
// Units: meters, seconds, radians. World: x in [0, TABLE_L], y in [0, TABLE_W].

export const TABLE_L = 2.24;            // 9ft playfield, 2:1
export const TABLE_W = 1.12;
export const BALL_R = 0.0286;           // 2.25" ball

export const DT = 1 / 120;              // fixed sim timestep
export const G = 9.81;

// Cloth (knobs)
export const MU_SLIDE = 0.2;            // sliding friction
export const MU_ROLL = 0.01;            // rolling resistance
export const MU_SPIN = 0.022;           // english decay

// Ball-ball (knobs)
export const E_BALL = 0.94;             // restitution — high = lively spreads
export const MU_BALL = 0.06;            // throw / spin-transfer friction
export const SPIN_TRANSFER = 0.12;      // english passed on contact

// Cushions (knobs)
export const E_CUSH = 0.75;
export const MU_CUSH = 0.2;
export const K_SPIN_RAIL = 0.6;         // how much english bends rebounds
export const RAIL_SPIN_KILL = 0.7;      // wz *= this per cushion hit

// Cue (knobs)
export const V_MAX = 6.5;               // m/s at power=1000
export const V_MAX_BREAK = 9.0;
export const SPIN_EFF = 0.85;           // >1 goes arcade
export const TIP_MAX = 50;              // |tip offset| cap, hundredths of R

// Rest / regime thresholds (determinism-critical — do not tune casually)
export const U_ROLL_EPS = 0.005;        // slip speed below which we snap to roll
export const V_REST = 0.005;
export const W_REST = 0.5;

// Pockets (knobs — oversized for fun; real corner ≈ 2.25R)
export const POCKET_R_CORNER = 0.075;
export const POCKET_R_SIDE = 0.065;
export const POCKET_OFF_CORNER = 0.0212; // capture center offset outside each corner (diagonal component)
export const POCKET_OFF_SIDE = 0.028;    // capture center offset outside side rails
export const MOUTH_CORNER = 0.117;       // rail span starts this far from a corner
export const MOUTH_SIDE = 0.082;         // half-width of side pocket mouths
export const JAW_DEPTH = 0.05;           // how far jaw segments angle outward

// Table markings
export const HEADSTRING_X = 0.56;
export const HEAD_SPOT = { x: 0.56, y: 0.56 };
export const FOOT_SPOT = { x: 1.68, y: 0.56 };

// Racking
export const RACK_SPACING = 2 * BALL_R + 0.0006; // touching + margin so jitter never overlaps
export const BREAK_JITTER = 0.0002;              // per-ball rack jitter, seeded from the break input

// Sim guards
export const MAX_STEPS = 3600;          // 30s hard cap per shot
export const MAX_EVENTS_PER_STEP = 8;

// Ball ids: 0 cue, 1-7 solids, 8, 9-15 stripes
export const BALL_COLORS = [
  '#f4f0e6', // cue
  '#f2c114', '#2b5bd7', '#e0392f', '#6b2d8b', '#e8762c', '#2e7d43', '#8f2b28',
  '#1a1a1f', // eight
  '#f2c114', '#2b5bd7', '#e0392f', '#6b2d8b', '#e8762c', '#2e7d43', '#8f2b28',
];

export const STATE = Object.freeze({
  STATIONARY: 0,
  SLIDING: 1,
  ROLLING: 2,
  POCKETED: 3,
});
