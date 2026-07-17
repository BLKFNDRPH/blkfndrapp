
"use client";
import './AnimatedWhale.css';

export function AnimatedWhale() {
  return (
    <div className="whale-container">
      <div className="orange-whale-line1"></div>
      <div className="orange-whale">
        <div className="orange-whale-main">
          <div className="orange-whale-eye"></div>
          <div className="gill-container">
            <div className="orange-whale-gill"></div>
          </div>
          <div className="orange-whale-color"></div>
          <div className="orange-whale-color-bottom"></div>
        </div>
        <div className="orange-whale-backside">
          <div></div>
        </div>
        <div className="orange-whale-flipper"></div>
      </div>
    </div>
  );
}
