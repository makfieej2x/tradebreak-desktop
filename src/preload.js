"use strict";

// The only bridge between the web terminal and the desktop shell.
// It exposes no Node APIs, no file access and no secrets.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tradebreakDesktop", {
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("desktop:version"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", String(url)),
});
