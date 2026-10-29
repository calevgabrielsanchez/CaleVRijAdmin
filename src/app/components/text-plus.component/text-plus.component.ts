import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, model } from '@angular/core';

@Component({
  selector: 'app-text-plus',
  standalone: true,
  templateUrl: './text-plus.component.html',
  styleUrl: './text-plus.component.css'
})
export class TextPlusComponent implements OnInit {
  @Input() bloqueaBackspace = true;
  readonly textoContenido = model<string>('');
  textoArea = '';
  vistaPergamino = '';
  code = true;
  help = false;
  private textOld = '';

  @Output() readonly cerrar = new EventEmitter<void>();
  @Output() readonly aceptar = new EventEmitter<void>();

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

  guardarYAceptar(): void {
    this.textoContenido.set(this.textoArea);
    this.aceptar.emit();
  }

  private escaparHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private renderTextoInline(texto: string): string {
    let html = this.escaparHtml(texto);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="destacado-verde">$1</strong>');
    return html.replace(/\*(.+?)\*/g, '<span class="destacado-azul">$1</span>');
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
