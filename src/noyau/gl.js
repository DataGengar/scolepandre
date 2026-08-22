/* ═══ NOYAU / GL ═══
   Contexte WebGL2 et les quatre utilitaires qui servent partout : compiler un
   shader, lier un programme, récupérer les uniformes, construire un maillage
   statique. Rien de spécifique au jeu.

   Le contexte est créé au premier import — c'est volontaire : tous les autres
   modules le veulent, et le créer deux fois n'aurait aucun sens. */

export const cv = document.getElementById('gl');

export const gl = cv.getContext('webgl2', {antialias:false, alpha:false, depth:true});

if(!gl){
  document.body.innerHTML =
    '<p style="padding:40px;font:12px monospace;color:#cfc7b4">WebGL2 indisponible.</p>';
  throw new Error('no webgl2');
}

/** Compile un shader ou lève avec le log du pilote. */
export function sh(type, source){
  const o = gl.createShader(type);
  gl.shaderSource(o, source);
  gl.compileShader(o);
  if(!gl.getShaderParameter(o, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(o));
  return o;
}

/** Lie un programme depuis les deux sources. */
export function prog(vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/** Récupère un lot d'emplacements d'uniformes en un objet {nom: loc}. */
export function unis(p, noms){
  const o = {};
  for(const k of noms) o[k] = gl.getUniformLocation(p, k);
  return o;
}

/**
 * Maillage statique à trois attributs : position (0), normale (1), couleur (2).
 * Renvoie {vao, bufs, count} — bufs sert à libérer proprement.
 */
export function mesh(P, N, C){
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bufs = [];
  [[P,0],[N,1],[C,2]].forEach(([d,l]) => {
    const b = gl.createBuffer(); bufs.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
  });
  gl.bindVertexArray(null);
  return {vao, bufs, count: P.length / 3};
}

/** Libère un maillage rendu par mesh(). */
export function libererMesh(m){
  if(!m) return;
  gl.deleteVertexArray(m.vao);
  m.bufs.forEach(b => gl.deleteBuffer(b));
}

/**
 * Boîte unitaire centrée en X/Z, de y0 à y1. Sert aux cartes, aux leurres et
 * au combustible — tout ce qui est dessiné avec une matrice de modèle.
 */
export function boite(y0, y1){
  const P=[], N=[], C=[];
  const q = (p,n) => {
    const u = v => { P.push(v[0],v[1],v[2]); N.push(n[0],n[1],n[2]); C.push(1,1,1); };
    u(p[0]);u(p[1]);u(p[2]); u(p[0]);u(p[2]);u(p[3]);
  };
  const a=-0.5, b=0.5;
  q([[a,y0,b],[b,y0,b],[b,y1,b],[a,y1,b]],[0,0,1]);
  q([[b,y0,a],[a,y0,a],[a,y1,a],[b,y1,a]],[0,0,-1]);
  q([[b,y0,b],[b,y0,a],[b,y1,a],[b,y1,b]],[1,0,0]);
  q([[a,y0,a],[a,y0,b],[a,y1,b],[a,y1,a]],[-1,0,0]);
  q([[a,y1,b],[b,y1,b],[b,y1,a],[a,y1,a]],[0,1,0]);
  q([[a,y0,a],[b,y0,a],[b,y0,b],[a,y0,b]],[0,-1,0]);
  return mesh(P,N,C);
}
