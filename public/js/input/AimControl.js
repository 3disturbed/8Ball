// Pointer aiming: dragging anywhere on the felt rotates the cue around the
// cue ball; because rotation is measured at the pointer's radius, sensitivity
// naturally scales with distance (the Miniclip trick). Also owns ball-in-hand
// placement dragging. Arrow keys nudge on desktop.

export function attachAim(canvas, controller, renderer) {
  let dragging = false;
  let placing = false;
  let lastAngle = 0;
  let pointerId = null;

  function worldPos(e) {
    const rect = canvas.getBoundingClientRect();
    return renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  function angleAround(cue, wx, wy) {
    return Math.atan2(wy - cue.y, wx - cue.x);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    const [wx, wy] = worldPos(e);

    if (controller.phase === 'ballInHand' && controller.canShoot) {
      pointerId = e.pointerId;
      placing = true;
      controller.setPlace(wx, wy);
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (!controller.canAim()) return;
    const cue = controller.phase === 'ballInHand' ? controller.pendingPlace : controller.cueBall();
    if (!cue) return;
    pointerId = e.pointerId;
    dragging = true;
    lastAngle = angleAround(cue, wx, wy);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const [wx, wy] = worldPos(e);
    if (placing) {
      controller.setPlace(wx, wy);
      return;
    }
    if (!dragging) return;
    const cue = controller.phase === 'ballInHand' ? controller.pendingPlace : controller.cueBall();
    if (!cue) return;
    const a = angleAround(cue, wx, wy);
    let delta = a - lastAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    controller.aim.angle += delta;
    lastAngle = a;
  });

  function release(e) {
    if (e.pointerId !== pointerId) return;
    dragging = false;
    placing = false;
    pointerId = null;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    if (!controller.canAim()) return;
    const fine = e.shiftKey ? 0.0006 : 0.004;
    if (e.key === 'ArrowLeft') { controller.aim.angle -= fine; e.preventDefault(); }
    if (e.key === 'ArrowRight') { controller.aim.angle += fine; e.preventDefault(); }
  });
}
