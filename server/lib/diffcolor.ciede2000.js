/**
 * Created by Peter on 2018. 5. 30..
 */

"use strict";


class ColorDiff {
    constructor(rgb1, rgb2){
        this._rgb1 = rgb1;
        this._rgb2 = rgb2;
    }

    set rgb1(rgb){this._rgb1 = rgb;}
    set rgb2(rgb){this._rgb2 = rgb;}
    set lab1(lab){this._lab1 = lab;}
    set lab2(lab){this._lab2 = lab;}

    get rgb1(){return this._rgb1;}
    get rgb2(){return this._rgb2;}
    get lab1(){return this._lab1;}
    get lab2(){return this._lab2;}


    /**
     * Public API
     */
    setRgbColor(rgb1, rgb2){
        this._rgb1 = rgb1;
        this._rgb2 = rgb2;
        return this;
    }

    convertRgbToLab(src, dst){
        let rgb1 = src || this.rgb1;
        let rgb2 = dst || this.rgb2;

        if(rgb1 === undefined || rgb2 === undefined){
            log.error('colorDiff > There is no rgb data', rgb1, rgb2);
            return this;
        }

        this.lab1 = this._rgb_to_lab(rgb1);
        this.lab2 = this._rgb_to_lab(rgb2);

        return this;
    }

    getDiff(src, dst){
        let lab1 = src || this.lab1;
        let lab2 = dst || this.lab2;

        if(lab1 === undefined || lab2 === undefined){
            log.error('colorDiff > There is no LAB data ', lab1, lab2);
            return 1000;
        }

        return this._ciede2000(lab1, lab2);
    }

    /**
     * Internal API
     */


    _degrees(n) { return n*(180/Math.PI); }
    _radians(n) { return n*(Math.PI/180); }

    _hp_f(x,y) //(7)
    {
        if(x === 0 && y === 0) return 0;
        else{
            let tmphp = this._degrees(Math.atan2(x,y));
            if(tmphp >= 0) return tmphp
            else           return tmphp + 360;
        }
    }

    _dhp_f(C1, C2, h1p, h2p) //(10)
    {
        if(C1*C2 === 0)              return 0;
        else if(Math.abs(h2p-h1p) <= 180) return h2p-h1p;
        else if((h2p-h1p) > 180)     return (h2p-h1p)-360;
        else if((h2p-h1p) < -180)    return (h2p-h1p)+360;
        else                         throw(new Error());
    }

    _a_hp_f(C1, C2, h1p, h2p) { //(14)
        if(C1*C2 === 0)                                     return h1p+h2p
        else if(Math.abs(h1p-h2p)<= 180)                         return (h1p+h2p)/2.0;
        else if((Math.abs(h1p-h2p) > 180) && ((h1p+h2p) < 360))  return (h1p+h2p+360)/2.0;
        else if((Math.abs(h1p-h2p) > 180) && ((h1p+h2p) >= 360)) return (h1p+h2p-360)/2.0;
        else                                                throw(new Error());
    }
    
    _rgb_to_lab(c)
    {
        return this._xyz_to_lab(this._rgb_to_xyz(c))
    }

    _rgb_to_xyz(c)
    {
        // Based on http://www.easyrgb.com/index.php?X=MATH&H=02
        let R = ( c.r / 255 );
        let G = ( c.g / 255 );
        let B = ( c.b / 255 );

        if ( R > 0.04045 ) R = Math.pow(( ( R + 0.055 ) / 1.055 ),2.4);
        else               R = R / 12.92;
        if ( G > 0.04045 ) G = Math.pow(( ( G + 0.055 ) / 1.055 ),2.4);
        else               G = G / 12.92;
        if ( B > 0.04045 ) B = Math.pow(( ( B + 0.055 ) / 1.055 ), 2.4);
        else               B = B / 12.92;

        R *= 100;
        G *= 100;
        B *= 100;

        // Observer. = 2°, Illuminant = D65
        let X = R * 0.4124 + G * 0.3576 + B * 0.1805;
        let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
        let Z = R * 0.0193 + G * 0.1192 + B * 0.9505;

        return {'x' : X, 'y' : Y, 'z' : Z};
    }

    _xyz_to_lab(c)
    {
        // Based on http://www.easyrgb.com/index.php?X=MATH&H=07
        let ref_Y = 100.000;
        let ref_Z = 108.883;
        let ref_X = 95.047; // Observer= 2°, Illuminant= D65
        let Y = c.y / ref_Y;
        let Z = c.z / ref_Z;
        let X = c.x / ref_X;
        if ( X > 0.008856 ) X = Math.pow(X, 1/3);
        else                X = ( 7.787 * X ) + ( 16 / 116 );
        if ( Y > 0.008856 ) Y = Math.pow(Y, 1/3);
        else                Y = ( 7.787 * Y ) + ( 16 / 116 );
        if ( Z > 0.008856 ) Z = Math.pow(Z, 1/3);
        else                Z = ( 7.787 * Z ) + ( 16 / 116 );
        let L = ( 116 * Y ) - 16;
        let a = 500 * ( X - Y );
        let b = 200 * ( Y - Z );
        return {'l' : L , 'a' : a, 'b' : b};
    }


    _ciede2000(c1,c2) {
        /**
         * Implemented as in "The CIEDE2000 Color-Difference Formula:
         * Implementation Notes, Supplementary Test Data, and Mathematical Observations"
         * by Gaurav Sharma, Wencheng Wu and Edul N. Dalal.
         */

            // Get L,a,b values for color 1
        let L1 = c1.l;
        let a1 = c1.a;
        let b1 = c1.b;

        // Get L,a,b values for color 2
        let L2 = c2.l;
        let a2 = c2.a;
        let b2 = c2.b;

        // Weight factors
        let kL = 1;
        let kC = 1;
        let kH = 1;

        /**
         * Step 1: Calculate C1p, C2p, h1p, h2p
         */
        let C1 = Math.sqrt(Math.pow(a1, 2) + Math.pow(b1, 2)) //(2)
        let C2 = Math.sqrt(Math.pow(a2, 2) + Math.pow(b2, 2)) //(2)

        let a_C1_C2 = (C1+C2)/2.0;             //(3)

        let G = 0.5 * (1 - Math.sqrt(Math.pow(a_C1_C2 , 7.0) /
            (Math.pow(a_C1_C2, 7.0) + Math.pow(25.0, 7.0)))); //(4)

        let a1p = (1.0 + G) * a1; //(5)
        let a2p = (1.0 + G) * a2; //(5)

        let C1p = Math.sqrt(Math.pow(a1p, 2) + Math.pow(b1, 2)); //(6)
        let C2p = Math.sqrt(Math.pow(a2p, 2) + Math.pow(b2, 2)); //(6)

        let h1p = this._hp_f(b1, a1p); //(7)
        let h2p = this._hp_f(b2, a2p); //(7)

        /**
         * Step 2: Calculate dLp, dCp, dHp
         */
        let dLp = L2 - L1; //(8)
        let dCp = C2p - C1p; //(9)

        let dhp = this._dhp_f(C1,C2, h1p, h2p); //(10)
        let dHp = 2*Math.sqrt(C1p*C2p)*Math.sin(this._radians(dhp)/2.0); //(11)

        /**
         * Step 3: Calculate CIEDE2000 Color-Difference
         */
        let a_L = (L1 + L2) / 2.0; //(12)
        let a_Cp = (C1p + C2p) / 2.0; //(13)

        let a_hp = this._a_hp_f(C1,C2,h1p,h2p); //(14)
        let T = 1-0.17*Math.cos(this._radians(a_hp-30))+0.24*Math.cos(this._radians(2*a_hp))+
            0.32*Math.cos(this._radians(3*a_hp+6))-0.20*Math.cos(this._radians(4*a_hp-63)); //(15)
        let d_ro = 30 * Math.exp(-(Math.pow((a_hp-275)/25,2))); //(16)
        let RC = Math.sqrt((Math.pow(a_Cp, 7.0)) / (Math.pow(a_Cp, 7.0) + Math.pow(25.0, 7.0)));//(17)
        let SL = 1 + ((0.015 * Math.pow(a_L - 50, 2)) /
            Math.sqrt(20 + Math.pow(a_L - 50, 2.0)));//(18)
        let SC = 1 + 0.045 * a_Cp;//(19)
        let SH = 1 + 0.015 * a_Cp * T;//(20)
        let RT = -2 * RC * Math.sin(this._radians(2 * d_ro));//(21)
        let dE = Math.sqrt(Math.pow(dLp /(SL * kL), 2) + Math.pow(dCp /(SC * kC), 2) +
            Math.pow(dHp /(SH * kH), 2) + RT * (dCp /(SC * kC)) *
            (dHp / (SH * kH))); //(22)
        return dE;
    }
}

module.exports = ColorDiff;
