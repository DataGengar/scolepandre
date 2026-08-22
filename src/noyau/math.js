/* ═══ NOYAU / MATH ═══
   Matrices 4×4 en Float32Array (colonne-majeur, comme GL les attend) et les
   quelques scalaires dont tout le monde a besoin. Aucun état, aucune
   dépendance : ce fichier est le socle, il n'importe rien.

   Repris tel quel de la v2 monofichier, plus rotZ utilisé par le roulis
   sismique de la caméra (la v2 n'avait pas de roulis). */

export const M = {
  mk: () => new Float32Array(16),

  ident(o){ o.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); return o; },

  mul(o,a,b){
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for(let i=0;i<4;i++){
      const b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      o[i*4]   = b0*a00+b1*a10+b2*a20+b3*a30;
      o[i*4+1] = b0*a01+b1*a11+b2*a21+b3*a31;
      o[i*4+2] = b0*a02+b1*a12+b2*a22+b3*a32;
      o[i*4+3] = b0*a03+b1*a13+b2*a23+b3*a33;
    }
    return o;
  },

  persp(o,fov,aspect,near,far){
    const t=1/Math.tan(fov/2); o.fill(0);
    o[0]=t/aspect; o[5]=t; o[11]=-1;
    o[10]=(far+near)/(near-far); o[14]=2*far*near/(near-far);
    return o;
  },

  trans(o,x,y,z){ M.ident(o); o[12]=x; o[13]=y; o[14]=z; return o; },
  rotY(o,a){ const c=Math.cos(a),s=Math.sin(a); M.ident(o); o[0]=c;o[2]=-s;o[8]=s;o[10]=c; return o; },
  rotX(o,a){ const c=Math.cos(a),s=Math.sin(a); M.ident(o); o[5]=c;o[6]=s;o[9]=-s;o[10]=c; return o; },
  rotZ(o,a){ const c=Math.cos(a),s=Math.sin(a); M.ident(o); o[0]=c;o[1]=s;o[4]=-s;o[5]=c; return o; },
  scale(o,x,y,z){ M.ident(o); o[0]=x;o[5]=y;o[10]=z; return o; },
};

export const clamp = (v,a,b) => v<a ? a : v>b ? b : v;
export const lerp  = (a,b,t) => a+(b-a)*t;

/* Bruit de hachage déterministe : même (x,z) → même valeur. Sert à teinter
   les cellules sans stocker un tableau de bruit. */
export const hash2 = (x,y) => {
  const s = Math.sin(x*127.1 + y*311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* Angle le plus court entre deux caps, dans [−π, π]. Écrit six fois dans la
   v2 avec des while() recopiés ; une seule fois ici. */
export function deltaAngle(a){
  while(a >  Math.PI) a -= 6.283185307;
  while(a < -Math.PI) a += 6.283185307;
  return a;
}

/* Matrices de travail partagées : trs() est appelée des centaines de fois par
   image, on n'alloue pas à chaque fois. */
const _a=M.mk(), _b=M.mk();

/* Translation · rotation (Y puis X puis Z) · échelle, en une passe. */
export function trs(o,x,y,z,yaw,pit,rol,sx,sy,sz){
  M.trans(_a,x,y,z); M.rotY(_b,yaw); M.mul(o,_a,_b);
  M.rotX(_b,pit); M.mul(o,o,_b);
  M.rotZ(_b,rol); M.mul(o,o,_b);
  M.scale(_b,sx,sy,sz); M.mul(o,o,_b);
  return o;
}
