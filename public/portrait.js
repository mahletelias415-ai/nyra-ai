/** Dense, deterministic stippling with an actual particle-assembly entrance. */
export function createPortrait(canvas, source) {
    const wrapper = canvas.closest('.portrait-wrap');
    const image = new Image();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const size = 600, inset = 22, step = 2.05, duration = 2100;
    let particles = [], gpu = null, flat = null, ready = false, inView = false;
    let animation = 0, lastFrame = 0, startedAt = null, density = 1;
    let scale = 1, targetScale = 1, shift = 0, targetShift = 0;
    let flatLight, flatDark;
    wrapper.classList.add('portrait-loading');

    // Average a small neighbourhood before stippling. Sampling the ink's own
    // print dots at one pixel produces moire and drops thin facial contours.
    function buildParticles() {
        const sample = document.createElement('canvas');
        sample.width = sample.height = size;
        const c = sample.getContext('2d', { willReadFrequently: true });
        c.fillStyle = '#fff';
        c.fillRect(0, 0, size, size);
        c.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
        const pixels = c.getImageData(0, 0, size, size).data;
        const random = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
        let index = 0, row = 0;
        for (let y = inset; y < size - inset; y += step, row++) {
            for (let x = inset + (row % 2) * step / 2; x < size - inset; x += step) {
                let darkness = 0;
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const i = ((Math.round(y) + dy) * size + Math.round(x) + dx) * 4;
                    darkness += 1 - (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255;
                }
                darkness /= 9;
                if (darkness < .045) continue;
                const seed = random(index++), angle = random(index + 319) * Math.PI * 2;
                const radius = 175 + random(index + 877) * 225;
                const dot = step * .53 * Math.sqrt(Math.min(1, Math.pow(darkness, .82) * 1.2));
                const px = x + (random(index + 141) - .5) * step * .34;
                const py = y + (random(index + 253) - .5) * step * .34;
                particles.push({ x:px, y:py, radius: dot, ox: 300 + Math.cos(angle) * radius, oy: 300 + Math.sin(angle) * radius * .84, delay: seed * .2 + y / size * .14, seed });
            }
        }
        canvas.dataset.particles = String(particles.length);
    }

    function shader(gl, type, source) {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('Portrait shader unavailable');
        return s;
    }
    function setupGPU() {
        const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
        if (!gl) return false;
        const program = gl.createProgram();
        gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, `
            attribute vec2 a_position; attribute vec2 a_origin;
            attribute float a_radius; attribute float a_delay;
            uniform float u_appear; uniform float u_density; uniform float u_scale;
            uniform float u_shift; uniform float u_breath;
            varying float v_alpha;
            void main() {
                float phase = clamp((u_appear - a_delay) / (1.0 - a_delay), 0.0, 1.0);
                float ease = 1.0 - pow(1.0 - phase, 3.0);
                vec2 p = mix(a_origin, a_position, ease);
                p.x += sin(phase * 7.0 + a_delay * 30.0) * (1.0 - ease) * 13.0;
                p = (p - vec2(300.0)) * u_scale + vec2(300.0 + u_shift, 300.0 + u_breath);
                gl_Position = vec4(p.x / 300.0 - 1.0, 1.0 - p.y / 300.0, 0.0, 1.0);
                gl_PointSize = max(1.0, a_radius * 2.0 * u_density * (0.55 + 0.45 * ease));
                float coverage = min(1.0, pow(a_radius * 2.0 * u_density, 2.0));
                v_alpha = smoothstep(0.0, 0.16, phase) * (0.2 + 0.8 * ease) * coverage;
            }
        `));
        gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, `
            precision mediump float; uniform vec3 u_ink; varying float v_alpha;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
                float edge = 1.0 - smoothstep(0.9, 1.0, d);
                gl_FragColor = vec4(u_ink, v_alpha * edge);
            }
        `));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Portrait program unavailable');
        gl.useProgram(program);
        const data = new Float32Array(particles.length * 6);
        particles.forEach((p, i) => data.set([p.x, p.y, p.ox, p.oy, p.radius, p.delay], i * 6));
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        for (const [name, count, offset] of [['a_position', 2, 0], ['a_origin', 2, 8], ['a_radius', 1, 16], ['a_delay', 1, 20]]) {
            const location = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, count, gl.FLOAT, false, 24, offset);
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const uniforms = Object.fromEntries(['appear','density','scale','shift','breath','ink'].map(x => [x, gl.getUniformLocation(program, 'u_' + x)]));
        gpu = { gl, program, buffer, uniforms };
        canvas.dataset.renderer = 'webgl-particles';
        return true;
    }
    function prepareFlat() {
        flatLight = document.createElement('canvas');
        flatLight.width = flatLight.height = canvas.width;
        const c = flatLight.getContext('2d');
        c.setTransform(density, 0, 0, density, 0, 0);
        c.fillStyle = '#151715';
        c.beginPath();
        for (const p of particles) { c.moveTo(p.x + p.radius, p.y); c.arc(p.x, p.y, p.radius, 0, Math.PI * 2); }
        c.fill();
        flatDark = document.createElement('canvas');
        flatDark.width = flatDark.height = canvas.width;
        const d = flatDark.getContext('2d');
        d.drawImage(flatLight, 0, 0);
        d.globalCompositeOperation = 'source-in';
        d.fillStyle = '#e5eae7';
        d.fillRect(0, 0, canvas.width, canvas.height);
    }
    function resize() {
        if (!ready) return;
        density = Math.min(2, Math.max(1.5, devicePixelRatio || 1));
        const pixels = Math.ceil(size * density);
        if (canvas.width !== pixels || canvas.height !== pixels) {
            canvas.width = canvas.height = pixels;
            if (flat) prepareFlat();
        }
        render();
    }
    function render() {
        if (!ready) return;
        const time = performance.now();
        const appear = motion.matches ? 1 : startedAt === null ? 0 : Math.min(1, (time - startedAt) / duration);
        const dark = document.body.classList.contains('dark');
        scale += (targetScale - scale) * (motion.matches ? 1 : .12);
        shift += (targetShift - shift) * (motion.matches ? 1 : .12);
        const breath = motion.matches ? 0 : Math.sin(time * .0006) * .3;
        if (gpu) {
            const {gl, uniforms:u} = gpu;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(dark ? 10 / 255 : 1, dark ? 12 / 255 : 1, dark ? 13 / 255 : 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(u.appear, appear); gl.uniform1f(u.density, density);
            gl.uniform1f(u.scale, scale); gl.uniform1f(u.shift, shift); gl.uniform1f(u.breath, breath);
            gl.uniform3f(u.ink, dark ? .9 : .045, dark ? .92 : .055, dark ? .91 : .05);
            gl.drawArrays(gl.POINTS, 0, particles.length);
        } else if (flat && flatLight) {
            flat.setTransform(density, 0, 0, density, 0, 0);
            flat.fillStyle = dark ? '#0a0c0d' : '#fff'; flat.fillRect(0, 0, size, size);
            flat.save(); flat.globalAlpha = Math.min(1, appear * 1.6);
            flat.translate(300 + shift, 300 + breath); flat.scale(scale, scale); flat.translate(-300, -300);
            flat.drawImage(dark ? flatDark : flatLight, 0, 0, size, size); flat.restore();
        }
    }
    function frame(t) {
        animation = 0;
        if (!ready || !inView || document.hidden || motion.matches) return;
        const frameInterval = startedAt !== null && t - startedAt < duration ? 16 : 50;
        if (t - lastFrame >= frameInterval) { render(); lastFrame = t; }
        animation = requestAnimationFrame(frame);
    }
    function syncAnimation() {
        if (animation) cancelAnimationFrame(animation);
        animation = 0;
        if (!ready) return;
        if (startedAt === null && inView && !document.hidden) startedAt = performance.now();
        render();
        if (inView && !document.hidden && !motion.matches) animation = requestAnimationFrame(frame);
    }
    image.onload = () => {
        buildParticles();
        try {
            if (!setupGPU()) {
                flat = canvas.getContext('2d');
                canvas.dataset.renderer = 'canvas-stipple';
            }
            ready = true;
            resize();
            if (flat) prepareFlat();
            wrapper.classList.remove('portrait-loading');
            wrapper.classList.add('ready');
            canvas.style.opacity = '1';
            syncAnimation();
        } catch {
            wrapper.classList.remove('portrait-loading', 'ready');
        }
    };
    image.onerror = () => wrapper.classList.remove('portrait-loading', 'ready');
    image.src = source;
    const observer = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; syncAnimation(); }, {threshold: .08});
    observer.observe(canvas);
    document.addEventListener('visibilitychange', syncAnimation);
    motion.addEventListener('change', syncAnimation);
    window.addEventListener('resize', resize);
    return {
        render,
        setChapter(value) {
            targetScale = [1, .99, 1.012, .995, .98][value] || 1;
            targetShift = [0, 1.2, -1.2, .7, 0][value] || 0;
            syncAnimation();
        },
        destroy() {
            if (animation) cancelAnimationFrame(animation);
            observer.disconnect();
            document.removeEventListener('visibilitychange', syncAnimation);
            motion.removeEventListener('change', syncAnimation);
            window.removeEventListener('resize', resize);
            if (gpu) {gpu.gl.deleteBuffer(gpu.buffer);gpu.gl.deleteProgram(gpu.program);}
        }
    };
}
