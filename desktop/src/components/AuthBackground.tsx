import { useEffect, useRef } from "react";

/**
 * Animated constellation behind the auth card: drifting nodes of varied sizes
 * across depth layers, connected by lines when close — echoing the NexusNotes
 * node-graph logo. Nodes twinkle, the whole field parallaxes gently toward the
 * cursor (nearer/bigger nodes move more), and nodes near the pointer are drawn
 * toward it and link to it, so it feels interactive without being loud.
 * Pure canvas; sits behind the card and never intercepts input.
 */
export function AuthBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let raf = 0;
    let t = 0;

    type Node = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      depth: number; // 0.35 (far, dim, slow) .. 1 (near, bright, fast)
      phase: number; // twinkle offset
    };
    let nodes: Node[] = [];

    // Pointer in css pixels relative to the canvas; smoothed for parallax.
    const pointer = { x: -9999, y: -9999, active: false };
    let smoothX = 0;
    let smoothY = 0;

    const LINK_DIST = 132;
    const POINTER_DIST = 200;
    const PARALLAX = 0.03;

    const seed = () => {
      const count = Math.round((width * height) / 15000);
      const n = Math.max(48, Math.min(120, count));
      nodes = Array.from({ length: n }, () => {
        const depth = 0.35 + Math.random() * 0.65;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3 * depth,
          vy: (Math.random() - 0.5) * 0.3 * depth,
          r: 0.8 + depth * 2.6, // varied sizes: ~0.8 .. 3.4
          depth,
          phase: Math.random() * Math.PI * 2,
        };
      });
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      smoothX = width / 2;
      smoothY = height / 2;
      seed();
    };

    const step = () => {
      t += 0.016;
      ctx.clearRect(0, 0, width, height);

      // Ease the parallax anchor toward the cursor (or back to centre).
      const targetX = pointer.active ? pointer.x : width / 2;
      const targetY = pointer.active ? pointer.y : height / 2;
      smoothX += (targetX - smoothX) * 0.06;
      smoothY += (targetY - smoothY) * 0.06;
      const offX = smoothX - width / 2;
      const offY = smoothY - height / 2;

      // Advance physics and compute each node's drawn (parallaxed) position.
      const dx0: number[] = [];
      const dy0: number[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (pointer.active) {
          const ax = pointer.x - node.x;
          const ay = pointer.y - node.y;
          if (ax * ax + ay * ay < POINTER_DIST * POINTER_DIST) {
            node.vx += ax * 0.00016;
            node.vy += ay * 0.00016;
          }
        }
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.992;
        node.vy *= 0.992;
        if (Math.abs(node.vx) < 0.04 * node.depth) node.vx += (Math.random() - 0.5) * 0.04;
        if (Math.abs(node.vy) < 0.04 * node.depth) node.vy += (Math.random() - 0.5) * 0.04;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
        node.x = Math.max(0, Math.min(width, node.x));
        node.y = Math.max(0, Math.min(height, node.y));
        dx0[i] = node.x + offX * node.depth * PARALLAX * 20;
        dy0[i] = node.y + offY * node.depth * PARALLAX * 20;
      }

      // Links between nearby nodes.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = dx0[i] - dx0[j];
          const dy = dy0[i] - dy0[j];
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            ctx.strokeStyle = `rgba(203, 166, 247, ${(1 - d / LINK_DIST) * 0.2})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(dx0[i], dy0[i]);
            ctx.lineTo(dx0[j], dy0[j]);
            ctx.stroke();
          }
        }
        // Link to the cursor.
        if (pointer.active) {
          const pdx = dx0[i] - pointer.x;
          const pdy = dy0[i] - pointer.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd < POINTER_DIST) {
            ctx.strokeStyle = `rgba(137, 180, 250, ${(1 - pd / POINTER_DIST) * 0.4})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(dx0[i], dy0[i]);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      // Nodes, with a gentle twinkle.
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const twinkle = 0.55 + 0.45 * Math.sin(t * 1.6 + node.phase);
        ctx.fillStyle = `rgba(203, 166, 247, ${(0.35 + node.depth * 0.45) * twinkle})`;
        ctx.beginPath();
        ctx.arc(dx0[i], dy0[i], node.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    };
    const onPointerLeave = () => {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
    };

    resize();
    step();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-constellation" aria-hidden="true" />;
}
