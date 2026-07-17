import React from 'react';

export function StaticCubeAvatar() {
  return (
    <div className="relative w-40 h-40">
      {/* Cube Body */}
      <div className="w-full h-full bg-primary rounded-2xl shadow-lg border-2 border-primary-foreground/50"></div>

      {/* Eyes */}
      <div className="absolute top-1/2 -mt-10 left-1/2 -translate-x-1/2 flex gap-5">
        <div className="relative w-12 h-16 bg-white rounded-full border-2 border-gray-800">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-gray-800 rounded-full"></div>
          <div className="absolute top-3 left-4 w-3 h-3 bg-white rounded-full opacity-80"></div>
        </div>
        <div className="relative w-12 h-16 bg-white rounded-full border-2 border-gray-800">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-gray-800 rounded-full"></div>
          <div className="absolute top-3 left-4 w-3 h-3 bg-white rounded-full opacity-80"></div>
        </div>
      </div>

      {/* Mouth */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-16 h-8 border-4 border-white border-t-0 rounded-b-full"></div>
    </div>
  );
}
