import { Component, inject, signal } from '@angular/core';
import {
  faSave, faFileHalfDashed, faGlobe, faBook, faEarthAmericas, faScroll, faImage,
  faCircleInfo, faSquarePlus, faBaby, faDragon, faMeteor, faSkullCrossbones, faTrashCan, faPenFancy,
  faDownload, faUpload, faRefresh, faUser, faPersonChalkboard, faPersonHiking, faPersonDressBurst,
  faBurger, faSquareXmark
} from '@fortawesome/free-solid-svg-icons';
import { TextPlusComponent } from '../text-plus.component/text-plus.component';
import { Personalidad } from '../../models/personalidad.model';
import { Valores } from '../../models/valores.model';
import { Miedos } from '../../models/miedos.model';
import { Emociones } from '../../models/emociones.modelo';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LocalCsvService } from '../../services/local-csv.service';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-mente.component',
  imports: [FormsModule, FaIconComponent, CommonModule, TextPlusComponent],

  templateUrl: './mente.component.html',
  styleUrl: './mente.component.css',
})
export class MenteComponent {
  faSave = faSave;
  faFileHalfDashed = faFileHalfDashed;
  faGlobe = faGlobe;
  faBook = faBook;
  faEarthAmericas = faEarthAmericas;
  faScroll = faScroll;
  faImage = faImage;
  faCircleInfo = faCircleInfo;
  faSquarePlus = faSquarePlus;
  faBaby = faBaby;
  faDragon = faDragon;
  faMeteor = faMeteor;
  faSkullCrossbones = faSkullCrossbones;
  faTrashCan = faTrashCan;
  faPenFancy = faPenFancy;
  faDownload = faDownload;
  faUpload = faUpload;
  faRefresh = faRefresh;
  faUser = faUser;
  faPersonChalkboard = faPersonChalkboard;
  faPersonHiking = faPersonHiking;
  faPersonDressBurst = faPersonDressBurst;
  faBurger = faBurger;
  faSquareXmark = faSquareXmark;

  mostrarTextPlus: boolean = false;
  mostrarMenuModal: boolean = false;
  textoAEditar: string = "";
  private textPlusPromiseResolver: ((value: string) => void) | null = null;

  personalidadVacia: Personalidad = {
    id: '',
    imagen: '',
    detalles: '',
    mbti: '',
    colorForma: '',
    oficio: '',
    descripcion: '',
    comoSon: '',
    cualidad: '',
    dondeEncaja: '',
    habilidad: '',
    valores: '',
    pareja: '',
    traumas: '',
    enfermedad: '',
    danan: '',
    CaleVRije: '',
    funcion: '',
    grupo: '',
    updatedAt: 0,
    _deleted: false
  };

  personalidadSeleccionada: Personalidad = this.personalidadVacia;

  personalidadDiv = true;
  valoresDiv = false;
  emocionesDiv = false;
  miedosDiv = false;

  private http = inject(HttpClient);
  private localCsv = inject(LocalCsvService);
  private dbService = inject(SupabaseService);

  personalidades = signal<Personalidad[]>([]);
  mbtiOptions = signal<string[]>([]);
  valoresOptions = signal<string[]>([]);
  miedosOptions = signal<string[]>([]);
  emocionesOptions = signal<string[]>([]);

  valoresVacio: Valores = {
    id: '',
    nombre: '',
    descripcion: '',
    frase: '',
    creatura: '',
    detalles: '',
    imagen: '',
    updatedAt: 0,
    _deleted: false
  };

  valoresSeleccionado: Valores = this.valoresVacio;
  todosValores = signal<Valores[]>([]);

  miedosVacio: Miedos = {
    id: '',
    nombre: '',
    descripcion: '',
    frase: '',
    creatura: '',
    detalles: '',
    imagen: '',
    updatedAt: 0,
    _deleted: false
  };

  miedosSeleccionado: Miedos = this.miedosVacio;
  todosMiedos = signal<Miedos[]>([]);

  emocionesVacia: Emociones = {
    id: '',
    nombre: '',
    descripcion: '',
    frase: '',
    creatura: '',
    detalles: '',
    imagen: '',
    updatedAt: 0,
    _deleted: false
  };

  emocionesSeleccionada: Emociones = this.emocionesVacia;
  todasEmociones = signal<Emociones[]>([]);

  ngOnInit() {
    this.cargarTablasCSV();
  }

  private mapOptions<T extends Record<string, any>>(items: T[] | undefined, key: string): string[] {
    return Array.from(
      new Set(
        (items ?? [])
          .map((item) => String(item?.[key] ?? '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);
    return values.map(value => value.trim());
  }

  private parseCsvRows<T extends Record<string, any>>(csvText: string): T[] {
    const lines = csvText
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return [];
    }

    const headers = this.splitCsvLine(lines[0]);
    const rows: T[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.splitCsvLine(lines[i]);
      const row: Record<string, any> = {};

      headers.forEach((header, index) => {
        row[header] = values[index] ?? '';
      });

      rows.push(row as T);
    }

    return rows;
  }

  async cargarTablasCSV() {
    const tablas = await this.localCsv.loadAllTables<object>(['personalidad', 'valores', 'miedos', 'emociones']);

    const personalidades = (tablas['personalidad'] as Personalidad[] ?? []);
    const valores = (tablas['valores'] as Valores[] ?? []);
    const miedos = (tablas['miedos'] as Miedos[] ?? []);
    const emociones = (tablas['emociones'] as Emociones[] ?? []);

    this.aplicarDatos(personalidades, valores, miedos, emociones);
  }

  // private async seedDesdeTemplate<T extends Record<string, any>>(
  //   fileName: string,
  //   tabla: string
  // ): Promise<T[]> {
  //   try {
  //     const csvText = await firstValueFrom(
  //       this.http.get(`/template/${fileName}.csv`, { responseType: 'text' as const })
  //     ) as string;
  //     const data = this.parseCsvRows<T>(csvText).map((fila) => ({
  //       ...fila,
  //       updatedAt: Date.now(),
  //       _deleted: false
  //     }));

  //     await this.localCsv.saveTable(tabla, data);

  //     return data;
  //   } catch (error) {
  //     console.error(`Error cargando CSV ${fileName}:`, error);
  //     return [];
  //   }
  // }

  private aplicarDatos(personalidades: Personalidad[], valores: Valores[], miedos: Miedos[], emociones: Emociones[]) {
    this.personalidades.set(personalidades);
    this.mbtiOptions.set(this.mapOptions(personalidades, 'mbti'));

    this.todosValores.set(valores);
    this.valoresOptions.set(this.mapOptions(valores, 'nombre'));

    this.todosMiedos.set(miedos);
    this.miedosOptions.set(this.mapOptions(miedos, 'nombre'));

    this.todasEmociones.set(emociones);
    this.emocionesOptions.set(this.mapOptions(emociones, 'nombre'));

    this.sincronizarSeleccion(personalidades, 'mbti', this.personalidadSeleccionada?.mbti ?? '', (item) => this.personalidadSeleccionada = { ...item }, this.personalidadVacia);
    this.sincronizarSeleccion(valores, 'nombre', this.valoresSeleccionado?.nombre ?? '', (item) => this.valoresSeleccionado = { ...item }, this.valoresVacio);
    this.sincronizarSeleccion(miedos, 'nombre', this.miedosSeleccionado?.nombre ?? '', (item) => this.miedosSeleccionado = { ...item }, this.miedosVacio);
    this.sincronizarSeleccion(emociones, 'nombre', this.emocionesSeleccionada?.nombre ?? '', (item) => this.emocionesSeleccionada = { ...item }, this.emocionesVacia);
  }

  private sincronizarSeleccion<T extends Record<string, any>>(
    items: T[],
    key: string,
    actual: string,
    setSelected: (item: T) => void,
    emptyItem: T
  ): void {
    if (!items.length) {
      setSelected({ ...emptyItem });
      return;
    }

    const match = actual && this.mapOptions(items, key).includes(actual)
      ? items.find((item) => String(item[key]).trim().toLowerCase() === actual.trim().toLowerCase())
      : undefined;

    setSelected(match ? { ...match } : { ...items[0] });
  }

  async onSincronizarCSVToBD() {
    await this.onGuardarCambios();

    const enBD = await this.dbService.sincronizarDesdeSupabase();
    if (!enBD) {
      return;
    }

    const aSubir: Record<string, object[]> = {};

    for (const [clave, filas] of Object.entries(this.obtenerTablasCSV())) {
      aSubir[clave] = this.soloMasRecientes(
        filas as { id?: string; updatedAt?: number }[],
        enBD[clave] ?? []
      );
    }

    await this.dbService.importarTablasATrxDB(aSubir);
    const resultado = await this.dbService.sincronizarConSupabase();
    alert(resultado
      ? 'Datos guardados y sincronizados con la nube correctamente.'
      : 'No se pudieron sincronizar los datos con la nube.');
  }

  async onSincronizarBDToCSV() {
    const tablas = await this.dbService.sincronizarDesdeSupabase();
    if (!tablas) {
      return;
    }

    const locales = await this.localCsv.loadAllTables<object>(['personalidad', 'valores', 'miedos', 'emociones']);

    const personalidades = this.fusionar(locales['personalidad'] as Personalidad[] ?? [], tablas['personalidad'] as Personalidad[] ?? []);
    const valores = this.fusionar(locales['valores'] as Valores[] ?? [], tablas['valores'] as Valores[] ?? []);
    const miedos = this.fusionar(locales['miedos'] as Miedos[] ?? [], tablas['miedos'] as Miedos[] ?? []);
    const emociones = this.fusionar(locales['emociones'] as Emociones[] ?? [], tablas['emociones'] as Emociones[] ?? []);

    await this.localCsv.saveAllTables<object>({
      personalidad: personalidades,
      valores,
      miedos,
      emociones
    });

    this.aplicarDatos(personalidades, valores, miedos, emociones);

    alert('Datos descargados: solo se actualizaron/agregaron los registros de la nube más recientes.');
  }

  private obtenerTablasCSV(): Record<string, object[]> {
    return {
      personalidad: this.personalidades(),
      valores: this.todosValores(),
      miedos: this.todosMiedos(),
      emociones: this.todasEmociones(),
    };
  }

  async onGuardarCambios() {
    this.volcarSeleccionAlArray();
    await this.localCsv.saveAllTables(this.obtenerTablasCSV());
alert('Cambios guardados en CSV local correctamente.');
   /* const enBD = await this.dbService.sincronizarDesdeSupabase();
    if (!enBD) {
      alert('Se guardaron los cambios en CSV local, pero no se pudo sincronizar con Supabase.');
      return;
    }

    const aSubir: Record<string, object[]> = {};
    for (const [clave, filas] of Object.entries(this.obtenerTablasCSV())) {
      aSubir[clave] = this.soloMasRecientes(
        filas as { id?: string; updatedAt?: number }[],
        enBD[clave] ?? []
      );
    }

    await this.dbService.importarTablasATrxDB(aSubir);
    const resultado = await this.dbService.sincronizarConSupabase();
    alert(resultado
      ? 'Cambios guardados en CSV y sincronizados con Supabase correctamente.'
      : 'Se guardaron los cambios en CSV local, pero hubo un error al sincronizar con Supabase.');*/
  }

  private volcarSeleccionAlArray() {
    const ahora = Date.now();

    const idxP = this.personalidades().findIndex(p => p.mbti === this.personalidadSeleccionada?.mbti);
    if (idxP !== -1) {
      const copia = [...this.personalidades()];
      copia[idxP] = { ...this.personalidadSeleccionada, updatedAt: ahora };
      this.personalidades.set(copia);
    }

    const idxV = this.todosValores().findIndex(v => v.nombre === this.valoresSeleccionado?.nombre);
    if (idxV !== -1) {
      const copia = [...this.todosValores()];
      copia[idxV] = { ...this.valoresSeleccionado, updatedAt: ahora };
      this.todosValores.set(copia);
    }

    const idxM = this.todosMiedos().findIndex(m => m.nombre === this.miedosSeleccionado?.nombre);
    if (idxM !== -1) {
      const copia = [...this.todosMiedos()];
      copia[idxM] = { ...this.miedosSeleccionado, updatedAt: ahora };
      this.todosMiedos.set(copia);
    }

    const idxE = this.todasEmociones().findIndex(e => e.nombre === this.emocionesSeleccionada?.nombre);
    if (idxE !== -1) {
      const copia = [...this.todasEmociones()];
      copia[idxE] = { ...this.emocionesSeleccionada, updatedAt: ahora };
      this.todasEmociones.set(copia);
    }
  }

  private fusionar<T extends { id?: string; updatedAt?: number }>(locales: T[], nube: T[]): T[] {
    const mapaLocal = new Map<string, T>();

    for (const item of locales || []) {
      if (item?.id) {
        mapaLocal.set(item.id, item);
      }
    }

    for (const item of nube || []) {
      if (!item?.id) {
        continue;
      }

      const local = mapaLocal.get(item.id);
      if (!local || (item.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        mapaLocal.set(item.id, item);
      }
    }

    return Array.from(mapaLocal.values());
  }

  private soloMasRecientes<T extends { id?: string; updatedAt?: number }>(locales: T[], enBD: T[]): T[] {
    const porId = new Map<string, T>();

    for (const fila of enBD ?? []) {
      if (fila?.id) {
        porId.set(fila.id, fila);
      }
    }

    return (locales ?? []).filter(fila => {
      if (!fila?.id) {
        return false;
      }

      const bd = porId.get(fila.id);
      if (!bd) {
        return true;
      }

      return (fila.updatedAt ?? 0) > (bd.updatedAt ?? 0);
    });
  }

  cerrar() {
    this.closeTextPlus(this.textoAEditar);
  }

  private closeTextPlus(resolvedValue: string) {
    this.mostrarTextPlus = false;
    if (this.textPlusPromiseResolver) {
      this.textPlusPromiseResolver(resolvedValue);
      this.textPlusPromiseResolver = null;
    }
  }

  aceptar() {
    this.closeTextPlus(this.textoAEditar);
  }

  abrirTextPlus(texto: string): Promise<string> {
    this.textoAEditar = texto;
    this.mostrarTextPlus = true;
    return new Promise(resolve => {
      this.textPlusPromiseResolver = resolve;
    });
  }

  getId(): string {
    const ahora = Date.now();
    return ahora + '_' + Math.random().toString(36).substring(2, 5);
  }

  async onPersonalidadDetalles() {
    const contenido = await this.abrirTextPlus(this.personalidadSeleccionada.detalles);
    this.personalidadSeleccionada.detalles = contenido;
  }

  async onPersonalidadImagen() {
    const contenido = await this.abrirTextPlus(this.personalidadSeleccionada.imagen);
    this.personalidadSeleccionada.imagen = contenido;
  }

  onNuevaPersonalidad() {
    const nombre = prompt('Introduce el MBTI de la nueva personalidad', 'ENTP');
    if (nombre && nombre.trim() !== '') {
      const nueva = { ...this.personalidadVacia };
      nueva.id = this.getId();
      nueva.mbti = nombre.trim();
      nueva.updatedAt = Date.now();
      this.personalidades.update(arr => [...arr, nueva]);
      this.mbtiOptions.set(this.mapOptions(this.personalidades(), 'mbti'));
      this.personalidadSeleccionada = { ...nueva };
    }
  }

  onEliminarPersonalidad() {
    if (this.personalidadSeleccionada && this.personalidadSeleccionada.id) {
      const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar "${this.personalidadSeleccionada.mbti}"?`);
      if (confirmDelete) {
        this.personalidades.set(this.personalidades().filter(p => p.mbti !== this.personalidadSeleccionada.mbti));
        this.mbtiOptions.set(this.mapOptions(this.personalidades(), 'mbti'));
        this.personalidadSeleccionada = { ...this.personalidadVacia };
        alert('Personalidad eliminada correctamente.');
      }
    } else {
      alert('No hay una personalidad seleccionada para eliminar.');
    }
  }

  async onValorDetalles() {
    const contenido = await this.abrirTextPlus(this.valoresSeleccionado.detalles);
    this.valoresSeleccionado.detalles = contenido;
  }

  async onValorImagen() {
    const contenido = await this.abrirTextPlus(this.valoresSeleccionado.imagen);
    this.valoresSeleccionado.imagen = contenido;
  }

  onNuevoValor() {
    const nombre = prompt('Introduce el nombre del nuevo valor', 'Valor:');
    if (nombre && nombre.trim() !== '') {
      const nuevo = { ...this.valoresVacio };
      nuevo.id = this.getId();
      nuevo.nombre = nombre.trim();
      nuevo.updatedAt = Date.now();
      this.todosValores.update(arr => [...arr, nuevo]);
      this.valoresOptions.set(this.mapOptions(this.todosValores(), 'nombre'));
      this.valoresSeleccionado = { ...nuevo };
    }
  }

  onEliminarValor() {
    if (this.valoresSeleccionado && this.valoresSeleccionado.id) {
      const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar "${this.valoresSeleccionado.nombre}"?`);
      if (confirmDelete) {
        this.todosValores.set(this.todosValores().filter(v => v.nombre !== this.valoresSeleccionado.nombre));
        this.valoresOptions.set(this.mapOptions(this.todosValores(), 'nombre'));
        this.valoresSeleccionado = { ...this.valoresVacio };
        alert('Valor eliminado correctamente.');
      }
    } else {
      alert('No hay un valor seleccionado para eliminar.');
    }
  }

  async onMiedoDetalles() {
    const contenido = await this.abrirTextPlus(this.miedosSeleccionado.detalles);
    this.miedosSeleccionado.detalles = contenido;
  }

  async onMiedoImagen() {
    const contenido = await this.abrirTextPlus(this.miedosSeleccionado.imagen);
    this.miedosSeleccionado.imagen = contenido;
  }

  onNuevoMiedo() {
    const nombre = prompt('Introduce el nombre del nuevo miedo', 'Miedo:');
    if (nombre && nombre.trim() !== '') {
      const nuevo = { ...this.miedosVacio };
      nuevo.id = this.getId();
      nuevo.nombre = nombre.trim();
      nuevo.updatedAt = Date.now();
      this.todosMiedos.update(arr => [...arr, nuevo]);
      this.miedosOptions.set(this.mapOptions(this.todosMiedos(), 'nombre'));
      this.miedosSeleccionado = { ...nuevo };
    }
  }

  onEliminarMiedo() {
    if (this.miedosSeleccionado && this.miedosSeleccionado.id) {
      const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar "${this.miedosSeleccionado.nombre}"?`);
      if (confirmDelete) {
        this.todosMiedos.set(this.todosMiedos().filter(m => m.nombre !== this.miedosSeleccionado.nombre));
        this.miedosOptions.set(this.mapOptions(this.todosMiedos(), 'nombre'));
        this.miedosSeleccionado = { ...this.miedosVacio };
        alert('Miedo eliminado correctamente.');
      }
    } else {
      alert('No hay un miedo seleccionado para eliminar.');
    }
  }

  async onEmocionDetalles() {
    const contenido = await this.abrirTextPlus(this.emocionesSeleccionada.detalles);
    this.emocionesSeleccionada.detalles = contenido;
  }

  async onEmocionImagen() {
    const contenido = await this.abrirTextPlus(this.emocionesSeleccionada.imagen);
    this.emocionesSeleccionada.imagen = contenido;
  }

  onNuevaEmocion() {
    const nombre = prompt('Introduce el nombre de la nueva emoción', 'Emoción:');
    if (nombre && nombre.trim() !== '') {
      const nueva = { ...this.emocionesVacia };
      nueva.id = this.getId();
      nueva.nombre = nombre.trim();
      nueva.updatedAt = Date.now();
      this.todasEmociones.update(arr => [...arr, nueva]);
      this.emocionesOptions.set(this.mapOptions(this.todasEmociones(), 'nombre'));
      this.emocionesSeleccionada = { ...nueva };
    }
  }

  onEliminarEmocion() {
    if (this.emocionesSeleccionada && this.emocionesSeleccionada.id) {
      const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar "${this.emocionesSeleccionada.nombre}"?`);
      if (confirmDelete) {
        this.todasEmociones.set(this.todasEmociones().filter(e => e.nombre !== this.emocionesSeleccionada.nombre));
        this.emocionesOptions.set(this.mapOptions(this.todasEmociones(), 'nombre'));
        this.emocionesSeleccionada = { ...this.emocionesVacia };
        alert('Emoción eliminada correctamente.');
      }
    } else {
      alert('No hay una emoción seleccionada para eliminar.');
    }
  }

  mostrarMenu() {
    this.mostrarMenuModal = !this.mostrarMenuModal;
  }

  onClickCaleVRije() {
    window.location.href = '/';
  }
  onClickCreatividad() {
    window.location.href = '/creatividad';
  }

  onSelectPersonalidad(event: any) {
    const mbti = this.eventToStr(event);
    if (!mbti || mbti === '0') {
      this.personalidadSeleccionada = { ...this.personalidadVacia };
      return;
    }

    this.personalidadSeleccionada = this.personalidades().find(
      (p) => String(p.mbti).trim().toLowerCase() === String(mbti).trim().toLowerCase()
    ) ?? { ...this.personalidadVacia };
  }

  onSelectValor(event: any) {
    const nombre = this.eventToStr(event);
    if (!nombre || nombre === '0') {
      this.valoresSeleccionado = { ...this.valoresVacio };
      return;
    }

    this.valoresSeleccionado = this.todosValores().find(
      (v) => String(v.nombre).trim().toLowerCase() === String(nombre).trim().toLowerCase()
    ) ?? { ...this.valoresVacio };
  }

  onSelectMiedo(event: any) {
    const nombre = this.eventToStr(event);
    if (!nombre || nombre === '0') {
      this.miedosSeleccionado = { ...this.miedosVacio };
      return;
    }

    this.miedosSeleccionado = this.todosMiedos().find(
      (m) => String(m.nombre).trim().toLowerCase() === String(nombre).trim().toLowerCase()
    ) ?? { ...this.miedosVacio };
  }

  onSelectEmocion(event: any) {
    const nombre = this.eventToStr(event);
    if (!nombre || nombre === '0') {
      this.emocionesSeleccionada = { ...this.emocionesVacia };
      return;
    }

    this.emocionesSeleccionada = this.todasEmociones().find(
      (e) => String(e.nombre).trim().toLowerCase() === String(nombre).trim().toLowerCase()
    ) ?? { ...this.emocionesVacia };
  }

  eventToStr(event: any): string {
    if (typeof event === 'string') {
      return event;
    }
    if (event && event.target && event.target.value) {
      return event.target.value;
    }
    return '';
  }

  onSelecionarSeccion(seccion: string) {
    this.personalidadDiv = false;
    this.valoresDiv = false;
    this.emocionesDiv = false;
    this.miedosDiv = false;
    switch (seccion) {
      case 'personalidad':
        this.personalidadDiv = true;
        break;
      case 'valores':
        this.valoresDiv = true;
        break;
      case 'miedos':
        this.miedosDiv = true;
        break;
      case 'emociones':
        this.emocionesDiv = true;
        break;
    }
  }

  firstSincCSVToSupabase(){
    //this.dbService.sincronizarCSVTemplateSupabase();
  }

}
