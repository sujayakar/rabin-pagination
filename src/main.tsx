import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App.tsx";
import "./index.css";

export const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// TODO: Reenable StrictMode
ReactDOM.createRoot(document.getElementById("root")!).render(
    <ThemeProvider attribute="class">
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    </ThemeProvider>
);
