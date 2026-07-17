"use client";

import { cn } from '@/lib/utils';
import './CubeSpinner.css';

interface CubeSpinnerProps {
    className?: string;
    size?: 'small' | 'large';
}

export function CubeSpinner({ className, size = 'small' }: CubeSpinnerProps) {
    return (
        <div className={cn('spinner', size === 'large' && 'large', className)}>
            <div className="cube1"></div>
            <div className="cube2"></div>
        </div>
    );
}
