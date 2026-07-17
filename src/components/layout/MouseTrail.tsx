
"use client";

import React, { useRef, useEffect } from 'react';
import './MouseTrail.css';

// SVG paths for the Stellar logo
const STELLAR_SVG_PATH1 = "M203,26.16l-28.46,14.5-137.43,70a82.49,82.49,0,0,1-.7-10.69A81.87,81.87,0,0,1,158.2,28.6l16.29-8.3,2.43-1.24A100,100,0,0,0,18.18,100q0,3.82.29,7.61a18.19,18.19,0,0,1-9.88,17.58L0,129.57V150l25.29-12.89,0,0,8.19-4.18,8.07-4.11v0L186.43,55l16.28-8.29,33.65-17.15V9.14Z";
const STELLAR_SVG_PATH2 = "M236.36,50,49.78,145,33.5,153.31,0,170.38v20.41l33.27-16.95,28.46-14.5L199.3,89.24A83.45,83.45,0,0,1,200,100,81.87,81.87,0,0,1,78.09,171.36l-1,.53-17.66,9A100,100,0,0,0,218.18,100c0-2.57-.1-5.14-.29-7.68a18.2,18.2,0,0,1,9.87-17.58l8.6-4.38Z";
const STELLAR_SVG_VIEWBOX = "0 0 236.36 200";
const STELLAR_ASPECT_RATIO = 200 / 236.36;

// Pre-render the Stellar logo to an image
let stellarLogoImage: HTMLImageElement | null = null;
if (typeof window !== 'undefined') {
    stellarLogoImage = new Image();
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${STELLAR_SVG_VIEWBOX}" fill="%235cf"><path d="${STELLAR_SVG_PATH1}"/><path d="${STELLAR_SVG_PATH2}"/></svg>`;
    stellarLogoImage.src = `data:image/svg+xml;charset=utf-8,${svgString}`;
}

class Particle {
    x: number;
    y: number;
    size: number;
    life: number;
    initialLife: number;
    vx: number;
    vy: number;
    gravity: number;
    rotation: number;
    rotationSpeed: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 15 + 10; // size between 10 and 25
        this.life = 100 + Math.random() * 50;
        this.initialLife = this.life;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.gravity = 0.05;
        this.rotation = Math.random() * 360;
        this.rotationSpeed = (Math.random() - 0.5) * 2;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (!stellarLogoImage) return;

        ctx.save();
        ctx.globalAlpha = this.life / this.initialLife;
        
        // Translate and rotate for the particle
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation * Math.PI / 180);
        
        const height = this.size * STELLAR_ASPECT_RATIO;
        // Draw the image centered
        ctx.drawImage(stellarLogoImage, -this.size / 2, -height / 2, this.size, height);
        
        ctx.restore();
    }

    update() {
        this.vy += this.gravity;
        this.x += this.vx;
        this.y += this.vy;
        this.rotation += this.rotationSpeed;
        this.life -= 1;
    }
}

export function MouseTrail() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particles = useRef<Particle[]>([]);
    const mouse = useRef({ x: -9999, y: -9999 });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let frameCount = 0;
        let hasMouseMoved = false;

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!hasMouseMoved) {
                hasMouseMoved = true;
            }
            mouse.current = { x: e.clientX, y: e.clientY };
        };
        
        const handleTouchMove = (e: TouchEvent) => {
          if (e.touches.length > 0) {
            if (!hasMouseMoved) {
                hasMouseMoved = true;
            }
            mouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }
        }

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('touchmove', handleTouchMove);

        const animate = () => {
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                frameCount++;
    
                // Create new particles only if the mouse has moved and on every other frame
                if (hasMouseMoved && frameCount % 2 === 0) {
                    particles.current.push(new Particle(mouse.current.x, mouse.current.y));
                }
    
                // Update and draw particles
                for (let i = particles.current.length - 1; i >= 0; i--) {
                    const p = particles.current[i];
                    p.update();
                    p.draw(ctx);
                    if (p.life <= 0) {
                        particles.current.splice(i, 1);
                    }
                }
            }
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('touchmove', handleTouchMove);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return <canvas ref={canvasRef} id="mouse-trail-canvas" />;
}
