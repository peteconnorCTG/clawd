const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clawd", {
  interactive: (on) => ipcRenderer.send("ui:interactive", on),
  dragStart: () => ipcRenderer.send("ui:dragStart"),
  dragEnd: () => ipcRenderer.send("ui:dragEnd"),
  contextMenu: () => ipcRenderer.send("ui:contextMenu"),
  send: (text) => ipcRenderer.send("agent:send", text),
  stop: () => ipcRenderer.send("agent:stop"),
  newConversation: () => ipcRenderer.send("agent:new"),
  onEvent: (cb) => ipcRenderer.on("agent:event", (_e, payload) => cb(payload)),
  onToggleChat: (cb) => ipcRenderer.on("ui:toggleChat", () => cb()),
});
