// Script de recorder.html (estrategia "extension-iframe").
import { connectRemoteRecorder } from "./remote-recorder";

const sessionId = new URLSearchParams(location.search).get("session");
if (sessionId) connectRemoteRecorder(sessionId);
