import { createContext, useContext } from "react";

export const FreighterWalletContext = createContext<any>(null);

export const useFreighterWallet = () => {
  const context = useContext(FreighterWalletContext);
  if (context === null) {
    throw new Error(
      "useFreighterWallet must be used within a FreighterWalletProvider",
    );
  }
  return context;
};
