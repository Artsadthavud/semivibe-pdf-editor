import React, { useEffect, useRef, useState } from 'react';

type Props = {
  value: string; // hex
  onChange: (hex: string) => void;
};

function clamp(v: number, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }

function hsvToRgb(h: number, s: number, v: number) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHex(r: number, g: number, b: number) {
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r, g, b };
  }
  return { r: 0, g: 0, b: 0 };
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, v };
}

export default function ColorPicker({ value, onChange }: Props) {
  const svRef = useRef<HTMLCanvasElement | null>(null);
  const hueRef = useRef<HTMLCanvasElement | null>(null);
  const [hsv, setHsv] = useState(() => {
    try {
      const rgb = hexToRgb(value || '#FF0000');
      return rgbToHsv(rgb.r, rgb.g, rgb.b);
    } catch (e) {
      return { h: 0, s: 1, v: 1 };
    }
  });

  useEffect(() => {
    // Only update internal hsv if the incoming value actually differs
    // from the current hsv to avoid unnecessary setState calls that
    // can contribute to update loops.
    const rgb = hexToRgb(value || '#FF0000');
    const next = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const eps = 1e-6;
    if (
      Math.abs(next.h - hsv.h) > eps ||
      Math.abs((next.s || 0) - (hsv.s || 0)) > 1e-3 ||
      Math.abs((next.v || 0) - (hsv.v || 0)) > 1e-3
    ) {
      setHsv(next);
    }
  }, [value]);

  useEffect(() => {
    drawSV();
    drawHue();
  }, [hsv.h]);

  useEffect(() => {
    // update hex on hsv change, but avoid calling onChange if the resulting
    // hex matches the current controlled value — this prevents a prop->state
    // ->prop loop that can cause a maximum update depth exceeded error.
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    // normalize incoming prop to always include leading '#' and upper case
    const normalizedProp = value ? (value.startsWith('#') ? value.toUpperCase() : `#${value.toUpperCase()}`) : '';
    if (hex !== normalizedProp) {
      onChange(hex);
    }
  }, [hsv.h, hsv.s, hsv.v]);

  function drawSV() {
    const canvas = svRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    // fill with hue
    const { r, g, b } = hsvToRgb(hsv.h, 1, 1);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, w, h);
    // overlay white gradient (left->right)
    const g1 = ctx.createLinearGradient(0, 0, w, 0);
    g1.addColorStop(0, 'rgba(255,255,255,1)');
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    // overlay black gradient (top->bottom)
    const g2 = ctx.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }

  function drawHue() {
    const canvas = hueRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    // add color stops across the hue spectrum
    const stops = [
      '#ff0000', '#ff7f00', '#ffff00', '#7fff00', '#00ff00', '#00ff7f', '#00ffff', '#007fff', '#0000ff', '#7f00ff', '#ff00ff', '#ff007f', '#ff0000'
    ];
    const step = 1 / (stops.length - 1);
    stops.forEach((c, i) => grad.addColorStop(i * step, c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function handleSVPointer(e: React.PointerEvent) {
    const rect = svRef.current!.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width);
    const y = clamp((e.clientY - rect.top) / rect.height);
    // s = x, v = 1 - y
    setHsv((prev) => ({ ...prev, s: x, v: 1 - y }));
  }

  function handleHuePointer(e: React.PointerEvent) {
    const rect = hueRef.current!.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width);
    setHsv((prev) => ({ ...prev, h: x }));
  }

  // support dragging
  useEffect(() => {
    const sv = svRef.current;
    const hue = hueRef.current;
    if (!sv || !hue) return;
    let draggingSV = false;
    let draggingHue = false;
    const onMove = (ev: PointerEvent) => {
      if (draggingSV) {
        const rect = sv.getBoundingClientRect();
        const x = clamp((ev.clientX - rect.left) / rect.width);
        const y = clamp((ev.clientY - rect.top) / rect.height);
        setHsv((prev) => ({ ...prev, s: x, v: 1 - y }));
      } else if (draggingHue) {
        const rect = hue.getBoundingClientRect();
        const x = clamp((ev.clientX - rect.left) / rect.width);
        setHsv((prev) => ({ ...prev, h: x }));
      }
    };
    const onUp = () => { draggingSV = draggingHue = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    const onSVDown = (ev: PointerEvent) => { draggingSV = true; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); };
    const onHueDown = (ev: PointerEvent) => { draggingHue = true; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); };
    sv.addEventListener('pointerdown', onSVDown);
    hue.addEventListener('pointerdown', onHueDown);
    return () => {
      sv.removeEventListener('pointerdown', onSVDown);
      hue.removeEventListener('pointerdown', onHueDown);
    };
  }, []);

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

  return (
    <div className="color-picker">
      <canvas ref={svRef} className="cp-sv" width={220} height={160} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); handleSVPointer(e); }} onPointerMove={(e) => { if (e.buttons === 1) handleSVPointer(e); }} />
      <div className="cp-side">
        <canvas ref={hueRef} className="cp-hue" width={220} height={16} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); handleHuePointer(e); }} onPointerMove={(e) => { if (e.buttons === 1) handleHuePointer(e); }} />
        <div className="cp-controls">
          <div className="cp-swatch" style={{ backgroundColor: hex }} aria-hidden />
          <input className="cp-hex" aria-label="Hex color" title="Hex color" value={hex} onChange={(e) => { const v = e.target.value; // accept # or not
            const withHash = v.startsWith('#') ? v : `#${v}`;
            const parsed = hexToRgb(withHash);
            setHsv(rgbToHsv(parsed.r, parsed.g, parsed.b));
          }} />
        </div>
      </div>
    </div>
  );
}
