// 設定頁：音效、桌面顏色、存檔匯出 / 匯入、圖片來源。
import { SaveError } from '../../core/save';
import { exportAll, importAll } from '../../core/storage';
import { confirmDialog, el, esc, header, mount, toast } from '../dom';
import { fileDate } from '../format';
import { nav } from '../nav';
import { applySettings, content, persist, refreshTitles, store } from '../state';
import { S } from '../strings';
import { TABLE_COLORS } from '../theme';

export function showSettings() {
  const { settings } = store.save;
  const colors = TABLE_COLORS.map((c) => {
    const name = esc(S.tableNames[c.id] ?? c.id);
    return `<button class="swatch ${c.id === settings.table ? 'active' : ''}" data-id="${c.id}" style="background:${c.css}" aria-label="${name}"><span>${name}</span></button>`;
  }).join('');
  const credits = content.images
    .map(
      (i) =>
        `<li><b>${esc(i.name)}</b> — ${esc(i.artist ?? '')}（${esc(i.license ?? '')}）${i.sourceUrl ? ` <a href="${esc(i.sourceUrl)}" target="_blank" rel="noopener">Commons</a>` : ''}</li>`,
    )
    .join('');
  const node = el(`<main class="screen settings-screen">
      <section class="panel-card"><h2>${S.sound}</h2>
        <div class="row"><button class="btn toggle sound-on ${settings.sound ? 'active' : ''}">${S.on}</button><button class="btn toggle sound-off ${settings.sound ? '' : 'active'}">${S.off}</button></div>
      </section>
      <section class="panel-card"><h2>${S.tableColor}</h2><div class="swatches">${colors}</div></section>
      <section class="panel-card"><h2>${S.startPlace}</h2>
        <div class="row"><button class="btn toggle place-tray ${settings.startInTray ? 'active' : ''}">${S.placeTray}</button><button class="btn toggle place-table ${settings.startInTray ? '' : 'active'}">${S.placeTable}</button></div>
      </section>
      <section class="panel-card"><h2>${S.saveData}</h2><p class="muted">${S.exportHint}</p>
        <div class="row"><button class="btn export">${S.exportSave}</button><button class="btn import">${S.importSave}</button></div>
        <input type="file" accept="application/json,.json" class="hidden file">
      </section>
      <section class="panel-card"><details><summary><h2>${S.credits}</h2></summary><p class="muted">${S.creditsHint}</p><ul class="credits">${credits}</ul></details></section>
    </main>`);
  node.prepend(header(S.settings, nav.home));

  /** 修改設定後套用、存檔並重畫本頁 */
  const update = async (change: () => void) => {
    change();
    applySettings();
    await persist();
    showSettings();
  };
  node.querySelector('.sound-on')!.addEventListener('click', () => void update(() => (settings.sound = true)));
  node.querySelector('.sound-off')!.addEventListener('click', () => void update(() => (settings.sound = false)));
  node.querySelector('.place-tray')!.addEventListener('click', () => void update(() => (settings.startInTray = true)));
  node.querySelector('.place-table')!.addEventListener('click', () => void update(() => (settings.startInTray = false)));
  node.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) => b.addEventListener('click', () => void update(() => (settings.table = b.dataset.id!))));

  node.querySelector('.export')!.addEventListener('click', () => void exportSave());
  const file = node.querySelector<HTMLInputElement>('.file')!;
  node.querySelector('.import')!.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) void importSave(f);
  });
  mount(node);
}

async function exportSave() {
  const data = await exportAll(store.save);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `puzzle-save-${fileDate()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importSave(file: File) {
  if (!(await confirmDialog(S.importConfirm))) return;
  try {
    store.save = await importAll(await file.text());
  } catch (e) {
    const reason = e instanceof SaveError ? S.saveError[e.code] : String((e as Error).message);
    toast(esc(S.importFailed(reason)), 'error');
    return;
  }
  // 匯入的存檔可能已達成目前版本才有的稱號
  if (refreshTitles().length) await persist();
  applySettings();
  toast(esc(S.importDone));
  showSettings();
}
