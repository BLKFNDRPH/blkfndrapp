"use client";

import React from "react";
import "./AnimatedSpaceship.css";
import { StellarLogo } from "./StellarLogo";

export function AnimatedSpaceship() {
  return (
    <div className="spaceship-container">
      <div className="spaceship">
        {/* Fire/Thruster flame */}
        <div className="thruster-container">
          <div className="flame outer-flame"></div>
          <div className="flame middle-flame"></div>
          <div className="flame inner-flame"></div>
        </div>

        {/* Thruster exhaust nozzle */}
        <div className="engine-nozzle"></div>

        {/* Wings/Fins (Placed outside body as siblings to sit behind it) */}
        <div className="fin top-fin"></div>
        <div className="fin bottom-fin"></div>

        {/* Main Body of the ship */}
        <div className="spaceship-body">
          {/* Glowing Viewport Window */}
          <div className="viewport">
            <div className="viewport-glow"></div>
          </div>

          {/* Sleek Body Stripe */}
          <div className="body-stripe"></div>

          {/* Stellar Logo/Emblem */}
          <div className="stellar-logo-container">
            <StellarLogo className="stellar-ship-logo" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(AnimatedSpaceship);
