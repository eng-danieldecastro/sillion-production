export type TipoCampo = "texto" | "paragrafo" | "radio" | "lista" | "caixas";

export interface Campo {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  opcoes?: string[];
  grupos?: { titulo: string; opcoes: string[] }[];   // subseções (ex.: Hardware / Software / Outros)
}

export interface Formulario {
  slug: string;
  titulo: string;
  descricao: string | null;
  campos: Campo[];
  ordem: number;
}

export interface Perfil {
  id: string;
  nome: string;
  usuario: string;
  email_sillion: string | null;
  papel: "admin" | "operador";
  ativo: boolean;
  trocar_senha: boolean;
}

export interface RespostaPendente {
  id_cliente: string;
  formulario: string;
  titulo: string;
  usuario_id: string;
  email_registrado: string | null;
  preenchido_em: string;
  dados: Record<string, string | string[]>;
  tentativas: number;
  ultimo_erro?: string;
}
