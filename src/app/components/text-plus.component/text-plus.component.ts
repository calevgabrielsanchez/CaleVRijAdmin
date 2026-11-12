import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild, inject, model } from '@angular/core';
import { LibraryTreeService } from '../../services/library-tree.service';
import type { LibraryMediaSource } from '../../services/library-tree.service';
import { MediaReferenceService } from '../../services/media-reference.service';

@Component({
  selector: 'app-text-plus',
  standalone: true,
  templateUrl: './text-plus.component.html',
  styleUrl: './text-plus.component.css'
})
export class TextPlusComponent implements OnInit, OnDestroy {
  @ViewChild('editor') private editor?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pergamino') private pergamino?: ElementRef<HTMLDivElement>;
  private readonly libraryTree = inject(LibraryTreeService);
  private readonly mediaReferences = inject(MediaReferenceService);
  @Input() bloqueaBackspace = true;
  readonly textoContenido = model<string>('');
  textoArea = '';
  vistaPergamino = '';
  code = true;
  help = false;
  private textOld = '';
  private imageRenderGeneration = 0;
  private readonly referenceImageUrls = new Map<string, string>();
  referenceMessage = '';

  @Output() readonly cerrar = new EventEmitter<void>();
  @Output() readonly aceptar = new EventEmitter<string>();
  @Output() readonly mediaReference = new EventEmitter<File | LibraryMediaSource>();

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.bloqueaBackspace) return;
    const target = event.target as HTMLElement | null;
    const insideEditor = !!target && this.elementRef.nativeElement.contains(target);
    const editable = !!target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable);
    if (event.key === 'Backspace' && insideEditor && !editable && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  ngOnInit(): void {
    this.textoArea = this.textoContenido() ?? '';
    this.actualizarVistaPergamino();
  }

  ngOnDestroy(): void {
    for (const url of this.referenceImageUrls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    this.referenceImageUrls.clear();
  }

  guardarYAceptar(): void {
    this.textoContenido.set(this.textoArea);
    this.aceptar.emit(this.textoArea);
  }

  insertarPrefijo(prefijo: string): void {
    const start = this.editor?.nativeElement.selectionStart ?? this.textoArea.length;
    this.textoArea = this.textoArea.slice(0, start) + prefijo + this.textoArea.slice(start);
    this.actualizarVistaPergamino();
    this.restaurarCursor(start + prefijo.length);
  }

  envolverTexto(prefijo: string, sufijo: string): void {
    const editor = this.editor?.nativeElement;
    const start = editor?.selectionStart ?? this.textoArea.length;
    const end = editor?.selectionEnd ?? start;
    const seleccionado = this.textoArea.slice(start, end);
    this.textoArea = this.textoArea.slice(0, start) + prefijo + seleccionado + sufijo + this.textoArea.slice(end);
    this.actualizarVistaPergamino();
    this.restaurarCursor(start + prefijo.length + seleccionado.length);
  }

  async insertarReferencia(): Promise<void> {
    let reference = this.mediaReferences.take();
    if (!reference) {
      try { reference = await navigator.clipboard.readText(); }
      catch { /* El botón Copiar Referencia conserva la última referencia dentro de la app. */ }
    }
    if (!/^\[\[media:[^\]]+\]\]$/.test(reference.trim())) {
      this.referenceMessage = 'Copia primero una referencia desde los detalles de un archivo.';
      return;
    }
    this.referenceMessage = '';
    this.insertarPrefijo(reference.trim());
  }

  @HostListener('click', ['$event'])
  async openMediaReference(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('.pergamino-media-reference, .pergamino-media-image');
    const encodedPath = button?.title.startsWith('media-ref:') ? button.title.slice('media-ref:'.length) : undefined;
    if (!encodedPath) return;
    event.preventDefault();
    const segments = encodedPath.split('/');
    if (segments.length < 2) return;
    let libraryName: string;
    let path: string;
    try {
      libraryName = decodeURIComponent(segments.shift()!);
      path = segments.map(segment => decodeURIComponent(segment)).join('/');
    } catch {
      this.referenceMessage = 'La referencia del archivo no es válida.';
      return;
    }
    const library = this.libraryTree.libraries().find(item => item.name.toLocaleLowerCase() === libraryName.toLocaleLowerCase());
    if (!library) {
      this.referenceMessage = `No se encontró la biblioteca «${libraryName}».`;
      return;
    }
    try {
      const source = await this.libraryTree.getPlaybackSource(library, {
        libraryId: library.id, path, parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
        name: path.split('/').at(-1)!, kind: 'file', extension: '', mimeType: '', size: 0, lastModified: 0, depth: 0
      });
      this.referenceMessage = '';
      this.mediaReference.emit(source);
    } catch {
      this.referenceMessage = `No se pudo abrir «${path.split('/').at(-1)}». Comprueba que el archivo siga en la biblioteca.`;
    }
  }

  insertarTabla(): void {
    const editor = this.editor?.nativeElement;
    const start = editor?.selectionStart ?? this.textoArea.length;
    const end = editor?.selectionEnd ?? start;
    const apertura = '-/head,row:\n';
    const cierre = '\n:\n';
    this.textoArea = this.textoArea.slice(0, start) + apertura + cierre + this.textoArea.slice(end);
    this.actualizarVistaPergamino();
    this.restaurarCursor(start + apertura.length);
  }

  private restaurarCursor(position: number): void {
    setTimeout(() => {
      const editor = this.editor?.nativeElement;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(position, position);
    });
  }

  private escaparHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private renderTextoInline(texto: string): string {
    const references: string[] = [];
    const withReferenceTokens = texto.replace(/\[\[media:([^\]\r\n]+)\]\]/g, (reference, encodedPath: string) => {
      if (encodedPath.split('/').length < 2) return reference;
      const token = `CALEVRI_MEDIA_REF_${references.length}_TOKEN`;
      references.push(encodedPath);
      return token;
    });
    let html = this.escaparHtml(withReferenceTokens);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="destacado-verde">$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<span class="destacado-azul">$1</span>');
    return html.replace(/CALEVRI_MEDIA_REF_(\d+)_TOKEN/g, (_token, index: string) => {
      const encodedPath = references[Number(index)];
      let label = 'Abrir archivo multimedia';
      try { label = `▶ ${decodeURIComponent(encodedPath.split('/').slice(1).join('/'))}`; }
      catch { /* Se conserva una etiqueta genérica si la ruta no se puede decodificar. */ }
      const fileName = label.slice(2).split('/').at(-1) ?? '';
      if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fileName)) {
        return `<button type="button" class="pergamino-media-image" title="media-ref:${this.escaparHtml(encodedPath)}"><img class="pergamino-reference-image" alt="${this.escaparHtml(fileName)}" title="media-ref:${this.escaparHtml(encodedPath)}"></button>`;
      }
      return `<button type="button" class="pergamino-media-reference" title="media-ref:${this.escaparHtml(encodedPath)}">${this.escaparHtml(label)}</button>`;
    });
  }

  private renderDirWindow(titulo: string, contenido: string): string {
    return `<div class="dir-window"><div class="dir-title">${titulo}</div><div class="dir-body">${contenido}</div></div>`;
  }

  private renderTabla(contenido: string, opciones: string[]): string {
    const opcionesSet = new Set(opciones.map(option => option.trim().toLowerCase()));
    const lineas = contenido.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lineas.length) return '';
    const filas = lineas.map(line => this.lineaACeldas(line));
    const maxCols = filas.reduce((max, fila) => Math.max(max, fila.length), 0);
    const normalizadas = filas.map(fila => Array.from({ length: maxCols }, (_, index) => fila[index] ?? ''));
    return this.tablaHTML(normalizadas, opcionesSet.has('head'), opcionesSet.has('row'));
  }

  private lineaACeldas(linea: string): string[] {
    const celdas: string[] = [];
    let actual = '';
    let inQuotes = false;
    for (let i = 0; i < linea.length; i++) {
      const char = linea[i];
      if (char === '"') {
        if (inQuotes && linea[i + 1] === '"') { actual += '"'; i++; }
        else inQuotes = !inQuotes;
        continue;
      }
      if (char === ',' && !inQuotes) { celdas.push(actual.trim()); actual = ''; continue; }
      actual += char;
    }
    celdas.push(actual.trim());
    return celdas;
  }

  private tablaHTML(filas: string[][], resaltarHead: boolean, resaltarRow: boolean): string {
    if (!filas.length) return '';
    if (!resaltarHead && !resaltarRow) {
      return `<div class="tabla-csv"><table>${filas.map(row => `<tr>${row.map(cell => `<td>${this.renderTextoInline(cell)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    }
    let html = '<div class="tabla-csv"><table>';
    if (resaltarHead) html += `<thead><tr>${(filas[0] ?? []).map(cell => `<th class="head-tabla">${this.renderTextoInline(cell)}</th>`).join('')}</tr></thead>`;
    html += '<tbody>';
    for (let r = resaltarHead ? 1 : 0; r < filas.length; r++) {
      html += '<tr>';
      for (let c = 0; c < filas[r].length; c++) {
        const tag = c === 0 && resaltarRow ? 'th' : 'td';
        const className = tag === 'th' ? ' class="row-tabla"' : '';
        html += `<${tag}${className}>${this.renderTextoInline(filas[r][c])}</${tag}>`;
      }
      html += '</tr>';
    }
    return `${html}</tbody></table></div>`;
  }

  private renderLinea(linea: string): string {
    const limpio = linea.trim();
    if (!limpio) return '<br />';
    const primer = limpio.charAt(0), segundo = limpio.charAt(1), ultimo = limpio.charAt(limpio.length - 1);
    if (primer === '#') {
      const contenido = this.escaparHtml(limpio.slice(1));
      if (segundo === '#') return `<em>${this.escaparHtml(limpio.slice(2))}</em><br />`;
      if (segundo === '/') { const url = this.escaparHtml(limpio.slice(2)); return `<br /><a href="${url}" target="_blank">${url}</a><br />`; }
      return `<b>${contenido}</b><br />`;
    }
    if (primer === '@' && segundo === '/') {
      let url = this.escaparHtml(limpio.slice(2).trim());
      url = url.replace(/^https?:\/\/https?:\/\//, 'https://').replace(/^http:\/\/https:\/\//, 'https://').replace(/^https:\/\/http:\/\//, 'http://');
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      return `<a class="media-link" href="${url}" target="_blank" rel="noopener noreferrer"><div class="media-image"><img src="${url}" alt="Imagen" /></div></a>`;
    }
    if (primer === '(') {
      const clases: Record<string, string> = { '#': 'red', '@': 'yellow', '!': 'green', '?': 'blue', '/': 'grey' };
      return `<div class="${clases[segundo] ?? 'grey'}">${this.escaparHtml(limpio.slice(2, ultimo === ')' ? -1 : undefined))}</div>`;
    }
    if (primer === '-') return '';
    return `${this.renderTextoInline(limpio)}<br />`;
  }

  actualizarVistaPergamino(): void {
    if (!this.textoArea || !this.textoArea.trim()) { this.vistaPergamino = ''; return; }
    const lineas = this.textoArea.split(/\r?\n/);
    let html = '';
    let listaActual: { titulo: string; entradas: string[] } | null = null;
    let i = 0;
    while (i < lineas.length) {
      const linea = lineas[i], limpio = linea.trim();
      if (!limpio) { i++; continue; }
      const primer = limpio.charAt(0), segundo = limpio.charAt(1), tercero = limpio.charAt(2);
      if (primer === '-' && segundo === '/' && tercero !== '/' && limpio.indexOf(':') !== -1) {
        const apertura = limpio.slice(2), idxDosPuntos = apertura.indexOf(':');
        const opcionesRaw = apertura.slice(0, idxDosPuntos).trim(), opciones = opcionesRaw ? opcionesRaw.split(',') : [];
        let j = i + 1, body = '', abierto = false;
        while (j < lineas.length) {
          if (lineas[j].trim() === ':') { abierto = true; j++; break; }
          body += (body ? '\n' : '') + lineas[j]; j++;
        }
        if (abierto) {
          if (listaActual) { html += this.renderDirWindow(listaActual.titulo, listaActual.entradas.join('')); listaActual = null; }
          html += this.renderTabla(body, opciones); i = j; continue;
        }
      }
      if (primer === '-') {
        if (segundo === '-') {
          if (!listaActual) listaActual = { titulo: 'Lista', entradas: [] };
          listaActual.entradas.push(`<div class="dir-entry">${this.renderTextoInline(limpio.slice(2))}</div>`); i++; continue;
        }
        if (listaActual) html += this.renderDirWindow(listaActual.titulo, listaActual.entradas.join(''));
        listaActual = { titulo: this.renderTextoInline(limpio.slice(1)), entradas: [] }; i++; continue;
      }
      if (listaActual) { html += this.renderDirWindow(listaActual.titulo, listaActual.entradas.join('')); listaActual = null; }
      html += this.renderLinea(linea); i++;
    }
    if (listaActual) html += this.renderDirWindow(listaActual.titulo, listaActual.entradas.join(''));
    this.vistaPergamino = html;
    this.scheduleReferenceImageLoad();
  }

  private scheduleReferenceImageLoad(): void {
    const generation = ++this.imageRenderGeneration;
    setTimeout(() => { void this.loadReferenceImages(generation); });
  }

  private async loadReferenceImages(generation: number): Promise<void> {
    if (!this.code) return;
    const host = this.pergamino?.nativeElement;
    if (!host) return;
    const images = [...host.querySelectorAll<HTMLImageElement>('img.pergamino-reference-image')];
    for (const image of images) {
      const encodedPath = image.title.startsWith('media-ref:') ? image.title.slice('media-ref:'.length) : '';
      if (!encodedPath || image.hasAttribute('src')) continue;
      const cached = this.referenceImageUrls.get(encodedPath);
      if (cached) { image.src = cached; continue; }
      const segments = encodedPath.split('/');
      if (segments.length < 2) continue;
      try {
        const libraryName = decodeURIComponent(segments.shift()!);
        const path = segments.map(segment => decodeURIComponent(segment)).join('/');
        const library = this.libraryTree.libraries().find(item => item.name.toLocaleLowerCase() === libraryName.toLocaleLowerCase());
        if (!library) continue;
        const source = await this.libraryTree.getPlaybackSource(library, {
          libraryId: library.id, path, parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
          name: path.split('/').at(-1)!, kind: 'file', extension: '', mimeType: '', size: 0, lastModified: 0, depth: 0
        });
        const url = source instanceof File ? URL.createObjectURL(source) : source.url;
        this.referenceImageUrls.set(encodedPath, url);
        if (generation === this.imageRenderGeneration && image.isConnected) image.src = url;
      } catch {
        if (generation === this.imageRenderGeneration && image.isConnected) image.alt = `No se pudo cargar ${image.alt}`;
      }
    }
  }

  convertirPergamino(): void { this.code = true; this.actualizarVistaPergamino(); }
  convertirCodigo(): void { this.code = false; }

  onHelp(): void {
    if (!this.help) {
      this.textOld = this.textoArea;
      this.help = true;
      this.textoArea = `#Titulo\n##Sub titulo\n-Lista\n--Elemento\n--Elemento\n#/http://www.google.com\n\n(/Cita)\n\n(#Warning)\n\n(@Alert)\n\n(!Succes)\n\n(?default)\n\n-/head,row:\nhead1,head2,head3,head3\nrow1,valorA1,valorA2,valorA3\nrow2,valorB1,valorB2,valorB3\nrow3,valorC1,valorC2,valorC3\nrow4,valorD1,valorD2,valorD3\n:\n\nEste es el codigo de un *investigar* que funciona como un break\n\n@/https://www.maestrosdelweb.com/images/2009/08/crayones_png24.png`;
      this.actualizarVistaPergamino();
    } else {
      this.textoArea = this.textOld;
      this.help = false;
      this.actualizarVistaPergamino();
    }
  }
}
