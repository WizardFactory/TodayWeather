/**
 * Created by Peter on 2017. 10. 9..
 */

var mongoose = require("mongoose");

var townShortRssSchema = new mongoose.Schema({
    mCoord :{
        mx : Number,
        my : Number
    },
    pubDate: Date,
    fcsDate : Date, // forecast Date, 아래 날씨 데이터의 date와 동일한 date object 값.
    shortData : {
        ftm: String, /* Forecast Date */
        date : String,  /* YYYYMMDDHHMM */
        temp: {type : Number, default : -1},
        tmx: {type : Number, default : -50},
        tmn: {type : Number, default : -50},
        sky: {type : Number, default : -1},
        pty: {type : Number, default : -1},
        wfKor: {type : Number, default : -1},   /* 날씨 요약 : 1.맑음 2.구름조금 3. 구름많음 4.흐림 5.비 6.눈비 7.눈 */
        wfEn: {type : Number, default : -1},    /* 날씨 요약eng : 1.clear 2.Partly Cloudy 3.Mostly Cloudy 4.Cloudy 5.Rain 6.Snow/Rain 7.Snow */
        pop: {type : Number, default : -1},
        r12: {type : Number, default : -1},/*   [강수량범주 및 표시방법 / 저장값]
         ① 0.1mm 미만 (0mm 또는 없음) / 0 <= x < 0.1
         ② 0.1mm 이상 1mm 미만(1mm 미만) / 0.1 <= x < 1
         ③ 1mm 이상 5mm 미만(1~4mm) / 1 <= x < 5
         ④ 5mm 이상 10mm 미만(5~9mm) /5 <= x < 10
         ⑤ 10mm 이상 25mm 미만(10~24mm) / 10 <= x < 25
         ⑥ 25mm 이상 50mm 미만(25~49mm) / 25 <= x < 50
         ⑦ 50mm 이상(50mm 이상) / 50 <= x
         */
        s12: {type : Number, default : -1}, /*  [적설량범주 및 표시방법 / 저장값]
         ① 0.1cm 미만 (0mm 또는 없음) / 0 <= x < 0.1
         ② 0.1mm 이상 1mm 미만(1mm 미만) / 0.1 <= x < 1
         ③ 1mm 이상 5mm 미만(1~4mm) / 1 <= x < 5
         ④ 5mm 이상 10mm 미만(5~9mm) /5 <= x < 10
         ⑤ 10mm 이상 25mm 미만(10~24mm) / 10 <= x < 20
         ⑥ 50mm 이상(50mm 이상) / 20 <= x
         */
        ws: {type : Number, default : -1},  /* 풍속 */
        wd: {type : Number, default : -1},  /* 풍향 풍향 0~7 (북, 북동, 동, 남동, 남, 남서, 서, 북서) */
        wdKor: {type : Number, default : -1},   /* ① 동(E) ② 북(N) ③ 북동(NE) ④ 북서(NW) ⑤ 남(S) ⑥ 남동(SE) ⑦ 남서(SW) ⑧ 서(W) */
        wdEn: {type : Number, default : -1},    /* ① E(동) ② N(북) ③ NE(북동) ④ NW(북서) ⑤ S(남) ⑥ SE(남동) ⑦ SW(남서) ⑧ W(서) */
        reh: {type : Number, default : -1},
        r06: {type : Number, default : -1}, /*  [강수량범주 및 표시방법 / 저장값]
         ① 0.1mm 미만 (0mm 또는 없음) / 0 <= x < 0.1
         ② 0.1mm 이상 1mm 미만(1mm 미만) / 0.1 <= x < 1
         ③ 1mm 이상 5mm 미만(1~4mm) / 1 <= x < 5
         ④ 5mm 이상 10mm 미만(5~9mm) /5 <= x < 10
         ⑤ 10mm 이상 20mm 미만(10~19mm) / 10 <= x < 20
         ⑥ 40mm 이상 70mm 미만(40~69mm) / 40 <= x < 70
         ⑦ 70mm 이상(70mm 이상) / 70 <= x
         */
        s06: {type : Number, default : -1}  /*  [적설량범주 및 표시방법 / 저장값]
         ① 0.1cm 미만 (0mm 또는 없음) / 0 <= x < 0.1
         ② 0.1mm 이상 1mm 미만(1mm 미만) / 0.1 <= x < 1
         ③ 1mm 이상 5mm 미만(1~4mm) / 1 <= x < 5
         ④ 5mm 이상 10mm 미만(5~9mm) /5 <= x < 10
         ⑤ 10mm 이상 25mm 미만(10~24mm) / 10 <= x < 20
         ⑥ 50mm 이상(50mm 이상) / 20 <= x
         */
    }
});

townShortRssSchema.index({fcsDate:1});
townShortRssSchema.index({pubDate:1});
townShortRssSchema.index({mCoord:1});
townShortRssSchema.index({"mCoord.mx" : 1, "mCoord.my" : 1});

module.exports = mongoose.model('kma.town.short.rss', townShortRssSchema);

