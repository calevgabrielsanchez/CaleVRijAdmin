export interface Creatividad {
  id: string;
  nombre: string;
  desarrollo: string;
  updatedAt: number;
  _deleted: boolean;
}

export interface Memoria {
  id: string;
  updatedAt: number;
  _deleted: boolean;
  [key: string]: string | number | boolean;
}

export interface Dibujo {
  id: string;
  nombre: string;
  dibujo: string;
  historia: string;
  updatedAt: number;
  _deleted: boolean;
}

export interface CreatividadData {
  creatividad: Creatividad[];
  memorias: Memoria[];
  dibujos: Dibujo[];
  borradorCreatividad?: string;
}

export const EMPTY_CREATIVIDAD_DATA: CreatividadData = {
  creatividad: [],
  memorias: [],
  dibujos: [],
  borradorCreatividad: ''
};
