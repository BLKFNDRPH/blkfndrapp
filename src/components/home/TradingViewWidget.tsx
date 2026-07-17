'use client';

import React, { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

function TradingViewWidget() {
  const container = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const effectiveTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;


  useEffect(() => {
    if (!container.current) return;

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;

    const widgetConfig = {
      "allow_symbol_change": true,
      "calendar": false,
      "details": false,
      "hide_side_toolbar": true,
      "hide_top_toolbar": true,
      "hide_legend": false,
      "hide_volume": false,
      "hotlist": false,
      "interval": "D",
      "locale": "en",
      "save_image": true,
      "style": "1",
      "symbol": "CRYPTOCAP:XLM",
      "timezone": "Asia/Manila",
      "withdateranges": false,
      "compareSymbols": [
        { "symbol": "CRYPTOCAP:USDC", "position": "SameScale" },
        { "symbol": "CRYPTOCAP:USDT", "position": "SameScale" }
      ],
      "studies": [],
      "autosize": true,
      "theme": effectiveTheme,
      "backgroundColor": effectiveTheme === 'dark' ? "#1C1C1C" : "#FFFFFF",
      "gridColor": effectiveTheme === 'dark' ? "rgba(242, 242, 242, 0.06)" : "rgba(46, 46, 46, 0.06)",
    };

    script.innerHTML = JSON.stringify(widgetConfig);

    // Clear previous widget before appending new one
    if (container.current) {
      while (container.current.firstChild) {
        container.current.removeChild(container.current.firstChild);
      }
      container.current.appendChild(script);
    }

  }, [effectiveTheme]);

  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
    </div>
  );
}

export default React.memo(TradingViewWidget);
