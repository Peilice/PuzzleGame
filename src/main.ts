import './style.css';
import { loadSave, requestPersistence } from './core/storage';
import { setupPwa } from './pwa';
import { applyUpdateWhenSafe, startApp } from './ui/app';

async function boot() {
  void requestPersistence();
  // loadSave 不會丟錯：IndexedDB 無法使用時自動改以記憶體暫存，並由 issue 告知原因
  const { save, issue } = await loadSave();
  await startApp(save, issue);
  setupPwa(applyUpdateWhenSafe);
}

void boot();
