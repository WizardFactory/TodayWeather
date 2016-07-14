/**
 * informData+informCode가 기준임.
 * 새로 받은 데이터는 기존ㅇ informData에 업데이트 함.
 * inmage는 5, 23시에만 큰이미지, 23시에 오늘로 들어오는 이미지는 내일 예측모델임, 23시 당일 내용인지 확실치 않으나, 일단 그렇다고 봄.
 * Created by aleckim on 2016. 4. 1..
 */

var mongoose = require('mongoose');

var mdfSchema = new mongoose.Schema({
    informCode: String, //PM10, PM25, O3
    informData: String, //2016-04-03
    dataTime: String,    //2016-03-20 5시 발표, 11시, 17시 23시
    informCause: String,
    informOverall: String,
    informGrade: [
        {
            region: String, //서울, 제주, 세종 분류는 있으나, 예보 없음.
            grade: String, //예보없음, 좋음, 보통, 나쁨, 매우나쁨
        }
    ],
    imageUrl: [String]
});

mdfSchema.index({informData: 'text'});
mdfSchema.index({dataTime: 1});

module.exports = mongoose.model('MinuDustFrcst', mdfSchema);
