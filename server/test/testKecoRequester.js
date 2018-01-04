/**
 * Created by aleckim on 2015. 10. 24..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

var assert  = require('assert');
var Keco  = require('../lib/kecoRequester.js');
var config = require('../config/config');

describe('unit test - keco requester', function() {
    var keco;
    var list;

    it('create keco service', function () {
        keco = new Keco();
        keco.setServiceKeys(JSON.parse(config.keyString.airkorea_keys));
        assert.equal(keco._currentSidoIndex, 0, '');
    });

    //it ('_parse frcst', function (done) {
    //    var body = {"MinuDustFrcstDspthVo":{"_returnType":"xml","actionKnack":"","dataTime":"","imageUrl1":"","imageUrl2":"","imageUrl3":"","imageUrl4":"","imageUrl5":"","imageUrl6":"","informCause":"","informCode":"","informData":"","informGrade":"","informOverall":"","numOfRows":"999","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"2016-04-01","serviceKey":"pJgU9WpeXT9jnlUhdZftdPk53BA68c4inIUi4ycJe4iNHH9F/PS1pchRtnCa+SBLwlVt/rHwb44YC4ksQWcdEg==","totalCount":""},"list":[{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","informCause":"","informCode":"PM25","informData":"2016-04-02","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권의 경우 농도가 전일과 유사하거나 높아질 것으로 예상됨.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31959","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31960","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31961","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31962","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31963","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31964","informCause":"○ [미세먼지] 전일부터 축적된 미세먼지와 대기정체로 인해 이른 오후까지 대부분의 지역에서 농도가 높겠고, 오후 들어 대기확산이 원활해지면서 점차 ‘보통’ 수준을 회복하겠으나, 서쪽지역과 일부 중부내륙지역은 저녁부터 대기가 안정해지면서 농도가 다소 높아질 것으로 예상됨. \r\n○ [미세먼지] 다만, 수도권, 강원영서, 호남권, 제주권은 저녁부터 대기정체로 농도가 다소 높아질 것으로 예상됨.","informCode":"PM10","informData":"2016-04-01","informGrade":"서울 : 보통,경기북부 : 보통,경기남부 : 보통,영서 : 보통,영동 : 보통,대전 : 보통,세종 : 예보없음,충북 : 보통,충남 : 보통,부산 : 나쁨,대구 : 보통,울산 : 나쁨,경북 : 보통,경남 : 나쁨,광주 : 나쁨,전북 : 나쁨,전남 : 나쁨,제주 : 나쁨,인천 : 보통","informOverall":"○ [미세먼지] 호남권, 부산, 울산, 경남, 제주권은 ‘나쁨’, 그 밖의 권역은 ‘보통’으로 예상됨. 다만, 그 밖의 권역(강원영동 제외)에서도 이른 오후까지, 또, 수도권, 강원영서, 충청권은 저녁부터 ‘나쁨’ 수준의 농도가 일시적으로 나타날 수 있음.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31959","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31960","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31961","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31962","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31963","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31964","informCause":"○ [미세먼지] 전일부터 축적된 미세먼지와 대기정체로 인해 이른 오후까지 대부분의 지역에서 농도가 높겠고, 오후 들어 대기확산이 원활해지면서 점차 ‘보통’ 수준을 회복하겠으나, 서쪽지역과 일부 중부내륙지역은 저녁부터 대기가 안정해지면서 농도가 다소 높아질 것으로 예상됨. \r\n○ [미세먼지] 다만, 수도권, 강원영서, 호남권, 제주권은 저녁부터 대기정체로 농도가 다소 높아질 것으로 예상됨.","informCode":"PM25","informData":"2016-04-01","informGrade":"서울 : 보통,전남 : 나쁨,인천 : 보통,경기북부 : 보통,경기남부 : 보통,영서 : 보통,영동 : 보통,대전 : 보통,세종 : 예보없음,충북 : 보통,충남 : 보통,부산 : 나쁨,대구 : 보통,울산 : 나쁨,경북 : 보통,경남 : 나쁨,광주 : 나쁨,전북 : 나쁨,제주 : 나쁨","informOverall":"○ [미세먼지] 호남권, 부산, 울산, 경남, 제주권은 ‘나쁨’, 그 밖의 권역은 ‘보통’으로 예상됨. 다만, 그 밖의 권역(강원영동 제외)에서도 이른 오후까지, 또, 수도권, 강원영서, 충청권은 저녁부터 ‘나쁨’ 수준의 농도가 일시적으로 나타날 수 있음.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=","informCause":"","informCode":"O3","informData":"2016-04-01","informGrade":"서울 : 예보없음,인천 : 예보없음,울산 : 예보없음,경북 : 예보없음,경남 : 예보없음,광주 : 예보없음,전북 : 예보없음,전남 : 예보없음,제주 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,대구 : 예보없음","informOverall":"","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31953","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31954","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31955","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31956","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31957","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31958","informCause":"","informCode":"PM10","informData":"2016-04-03","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권 모레 예보는 17시에 발표됩니다.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31965","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31966","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31967","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31968","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31969","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31970","informCause":"","informCode":"PM10","informData":"2016-04-02","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권의 경우 농도가 다소 높을 것으로 예상됨.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31965","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31966","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31967","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31968","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31969","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31970","informCause":"","informCode":"PM25","informData":"2016-04-03","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권 모레 예보는 17시에 발표됩니다.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31965","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31966","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31967","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31968","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31969","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31970","informCause":"","informCode":"PM25","informData":"2016-04-02","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권의 경우 농도가 다소 높을 것으로 예상됨.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31947","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31948","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31949","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31950","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31951","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31952","informCause":"○ [미세먼지] 남해상에서 유입되는 미세먼지와 대기정체로 남부지방을 중심으로 농도가 높겠고 그 밖의 권역도 대기정체로 오전까지 농도가 높다가 오후 들어 대기확산이 원활해지면서 점차 대체로 청정한 대기상태로 회복될 것으로 예상됨.","informCode":"PM10","informData":"2016-04-01","informGrade":"제주 : 나쁨,서울 : 보통,인천 : 보통,경기북부 : 보통,경기남부 : 보통,영서 : 보통,영동 : 보통,대전 : 보통,충남 : 보통,충북 : 보통,세종 : 예보없음,부산 : 나쁨,대구 : 보통,울산 : 나쁨,경북 : 보통,경남 : 나쁨,광주 : 보통,전북 : 보통,전남 : 나쁨","informOverall":"○ [미세먼지] 호남권, 부산, 울산, 경남, 제주권은 ‘나쁨’, 그 밖의 권역은 ‘보통’으로 예상됨. 다만, 그 밖의 권역에서 오전까지 ‘나쁨’ 수준의 농도가 일시적으로 나타날 수 있음. ","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31947","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31948","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31949","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31950","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31951","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31952","informCause":"○ [미세먼지] 남해상에서 유입되는 미세먼지와 대기정체로 남부지방을 중심으로 농도가 높겠고 그 밖의 권역도 대기정체로 오전까지 농도가 높다가 오후 들어 대기확산이 원활해지면서 점차 대체로 청정한 대기상태로 회복될 것으로 예상됨.","informCode":"PM25","informData":"2016-04-01","informGrade":"부산 : 나쁨,충남 : 보통,전남 : 나쁨,전북 : 나쁨,광주 : 나쁨,경남 : 보통,경북 : 보통,울산 : 보통,대구 : 보통,서울 : 보통,인천 : 보통,경기북부 : 보통,경기남부 : 보통,영서 : 보통,영동 : 보통,대전 : 보통,세종 : 예보없음,충북 : 보통,제주 : 나쁨","informOverall":"○ [미세먼지] 호남권, 부산, 울산, 경남, 제주권은 ‘나쁨’, 그 밖의 권역은 ‘보통’으로 예상됨. 다만, 그 밖의 권역에서 오전까지 ‘나쁨’ 수준의 농도가 일시적으로 나타날 수 있음. ","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31953","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31954","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31955","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31956","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31957","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31958","informCause":"","informCode":"PM10","informData":"2016-04-02","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권의 경우 농도가 전일과 유사하거나 높아질 것으로 예상됨.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 05시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31953","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31954","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31955","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31956","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31957","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31958","informCause":"","informCode":"PM25","informData":"2016-04-03","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권 모레 예보는 17시에 발표됩니다.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31959","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31960","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31961","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31962","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31963","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31964","informCause":"","informCode":"O3","informData":"2016-04-01","informGrade":"제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음,서울 : 예보없음","informOverall":"","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""},{"_returnType":"xml","actionKnack":"","dataTime":"2016-04-01 11시 발표","imageUrl1":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31965","imageUrl2":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31966","imageUrl3":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31967","imageUrl4":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31968","imageUrl5":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31969","imageUrl6":"http://www.airkorea.or.kr/file/viewImage/?atch_id=31970","informCause":"","informCode":"PM10","informData":"2016-04-03","informGrade":"서울 : 예보없음,제주 : 예보없음,전남 : 예보없음,전북 : 예보없음,광주 : 예보없음,경남 : 예보없음,경북 : 예보없음,울산 : 예보없음,대구 : 예보없음,부산 : 예보없음,충남 : 예보없음,충북 : 예보없음,세종 : 예보없음,대전 : 예보없음,영동 : 예보없음,영서 : 예보없음,경기남부 : 예보없음,경기북부 : 예보없음,인천 : 예보없음","informOverall":"○ [미세먼지] 수도권 모레 예보는 17시에 발표됩니다.","numOfRows":"10","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"","serviceKey":"","totalCount":""}],"parm":{"_returnType":"xml","actionKnack":"","dataTime":"","imageUrl1":"","imageUrl2":"","imageUrl3":"","imageUrl4":"","imageUrl5":"","imageUrl6":"","informCause":"","informCode":"","informData":"","informGrade":"","informOverall":"","numOfRows":"999","pageNo":"1","resultCode":"","resultMsg":"","searchDate":"2016-04-01","serviceKey":"pJgU9WpeXT9jnlUhdZftdPk53BA68c4inIUi4ycJe4iNHH9F/PS1pchRtnCa+SBLwlVt/rHwb44YC4ksQWcdEg==","totalCount":""},"totalCount":14};
    //    var dataTime = { dataDate: '2016-04-01', dataHours: '11시 발표'};
    //
    //    console.log(body.list.length);
    //    var parsedList = keco._parseFrcst(body, dataTime.dataDate+' '+dataTime.dataHours);
    //    console.log(JSON.stringify(parsedList));
    //    done();
    //});

    var parsedList;
    it ('parse msr stn list', function () {
        var msrStnList= [{
            "_returnType": "xml",
            "addr": "경남 창원시 의창구 두대동145번지 시설관리공단 내 실내수영장 앞(원이대로 480)",
            "districtNum": "",
            "dmX": "35.232222",
            "dmY": "128.671389",
            "item": "SO2, CO, O3, NO2, PM10",
            "mangName": "도로변대기",
            "map": "http://www.airkorea.or.kr/airkorea/station_map/238145.gif",
            "numOfRows": "10",
            "oper": "경상남도보건환경연구원",
            "pageNo": "1",
            "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/238145/INSIDE_OTHER_1.jpg",
            "resultCode": "",
            "resultMsg": "",
            "rnum": 0,
            "serviceKey": "",
            "sggName": "",
            "sidoName": "",
            "stationCode": "",
            "stationName": "반송로",
            "tm": 0,
            "tmX": "",
            "tmY": "",
            "totalCount": "",
            "umdName": "",
            "vrml": "",
            "year": "2008"
        }, {
            "_returnType": "xml",
            "addr": "경남 창원시 성산구 사파동(창이대로 706길)106-1(16-23)",
            "districtNum": "",
            "dmX": "35.221729",
            "dmY": "128.69825",
            "item": "SO2, CO, O3, NO2, PM10",
            "mangName": "도시대기",
            "map": "http://www.airkorea.or.kr/airkorea/station_map/238146.gif",
            "numOfRows": "10",
            "oper": "경상남도보건환경연구원",
            "pageNo": "1",
            "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/238146/INSIDE_OTHER_1.jpg",
            "resultCode": "",
            "resultMsg": "",
            "rnum": 0,
            "serviceKey": "",
            "sggName": "",
            "sidoName": "",
            "stationCode": "",
            "stationName": "사파동",
            "tm": 0,
            "tmX": "",
            "tmY": "",
            "totalCount": "",
            "umdName": "",
            "vrml": "",
            "year": "2009"
        }];
        parsedList = keco.parseMsrstnList(msrStnList);

        assert.equal(2, parsedList.length, 'Fail to parse msr stn list');
    });

    //it('complete geo msr stn info', function (done) {
    //    var msrStn = {
    //        "_returnType": "xml",
    //        "addr": "강원 춘천시 중앙로 3가67-1(춘천시보건소 3층 옥상)",
    //        "districtNum": "",
    //        "dmX": "",
    //        "dmY": "",
    //        "item": "SO2, CO, O3, NO2, PM10",
    //        "mangName": "도시대기",
    //        "map": "http://www.airkorea.or.kr/airkorea/station_map/132112.gif",
    //        "numOfRows": "10",
    //        "oper": "강원도보건환경연구원",
    //        "pageNo": "1",
    //        "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/132112/INSIDE_OTHER_1.jpg",
    //        "resultCode": "",
    //        "resultMsg": "",
    //        "rnum": 0,
    //        "serviceKey": "",
    //        "sggName": "",
    //        "sidoName": "",
    //        "stationCode": "",
    //        "stationName": "중앙로",
    //        "tm": 0,
    //        "tmX": "",
    //        "tmY": "",
    //        "totalCount": "",
    //        "umdName": "",
    //        "vrml": "http://www.airkorea.or.kr/airkorea/vrml/132112.swf",
    //        "year": "2003"
    //    };
    //    //keco.getGeoInfo(msrStn.addr, function (err, result) {
    //    //    if (err) {
    //    //        log.error(err);
    //    //    }
    //    //    console.log(result);
    //    //    done();
    //    //});
    //
    //    keco.completeGeoMsrStnInfo([msrStn], function(err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        console.log(results);
    //        done();
    //    });
    //});

    it('get sido list', function () {
        list = keco.getCtprvnSidoList();
        assert.equal(list.length, keco._sidoList.length, '');
    });
    it('get Ctpvn url', function () {
        var url = keco.getUrlCtprvn(keco._sidoList[0], keco._svcKeys[0]);
        console.info(url);
        assert.notEqual(url.search('sidoName'), -1, '');
    });
    it('update time to get Ctpvn', function () {
        var time = new Date();
        time.setHours(time.getHours()+1);
        keco.updateTimeGetCtprvn();
        assert.equal(keco._nextGetCtprvnTime.getHours(), time.getHours(), '');
    });

    it('check time to get Ctpvn', function () {
        assert.equal(keco.checkGetCtprvnTime(new Date()), false, '');
    });

    it('parse Near By Msrstn', function (done) {
        var body = '<?xml version="1.0" encoding="UTF-8"?>'+
            '<response> <header> <resultCode>00</resultCode> <resultMsg>NORMAL SERVICE.</resultMsg> </header>'+
            '<body> <items> <item> <stationName>옥천동</stationName> <addr>강원 강릉시 옥천동327-2(옥천동주민센터)</addr> '+
            '<tm>2.1</tm> </item> <item> <stationName>천곡동</stationName> <addr>강원 동해시 천곡동806 (동해시청 4층 옥상)'+
            '</addr> <tm>32.5</tm> </item> <item> <stationName>남양동1</stationName> '+
            '<addr>강원 삼척시 남양동339-1 (남양동 주민센터 3층 옥상)</addr> <tm>42.8</tm> </item> </items> '+'' +
            '<numOfRows>999</numOfRows> <pageNo>1</pageNo> <totalCount>3</totalCount> </body> </response>';

        keco.getStationNameFromMsrstn(body, function (err, result) {
            if (err) {
                console.error(err);
            }
            else {
                assert.equal(result, '옥천동', '');
            }
            done();
        });
    });

    it('parse ctprvn', function (done) {
        var data = '<?xml version="1.0" encoding="UTF-8"?>\n<response>\n<header>\n<resultCode>22</resultCode>\n' +
            '<resultMsg>LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.</resultMsg>\n</header>\n</response>';

        keco.parseCtprvn(data, function (err) {
            assert.equal(!!err, true);
            done();
        });
    });

    it('parse ctprvn', function (done) {
        var data = {
            "list": [
                {
                    "_returnType": "json",
                    "coGrade": "1",
                    "coValue": "0.5",
                    "dataTerm": "",
                    "dataTime": "2018-01-04 08:00",
                    "khaiGrade": "2",
                    "khaiValue": "58",
                    "mangName": "도시대기",
                    "no2Grade": "2",
                    "no2Value": "0.035",
                    "numOfRows": "10",
                    "o3Grade": "1",
                    "o3Value": "0.005",
                    "pageNo": "1",
                    "pm10Grade": "1",
                    "pm10Grade1h": "2",
                    "pm10Value": "28",
                    "pm10Value24": "28",
                    "pm25Grade": "2",
                    "pm25Grade1h": "3",
                    "pm25Value": "16",
                    "pm25Value24": "16",
                    "resultCode": "",
                    "resultMsg": "",
                    "rnum": 0,
                    "serviceKey": "",
                    "sidoName": "",
                    "so2Grade": "1",
                    "so2Value": "0.004",
                    "stationCode": "",
                    "stationName": "중구",
                    "totalCount": "",
                    "ver": ""
                },
                {
                    "_returnType": "json",
                    "coGrade": "1",
                    "coValue": "0.5",
                    "dataTerm": "",
                    "dataTime": "2018-01-04 08:00",
                    "khaiGrade": "2",
                    "khaiValue": "80",
                    "mangName": "도로변대기",
                    "no2Grade": "2",
                    "no2Value": "0.048",
                    "numOfRows": "10",
                    "o3Grade": "1",
                    "o3Value": "0.004",
                    "pageNo": "1",
                    "pm10Grade": "2",
                    "pm10Grade1h": "1",
                    "pm10Value": "29",
                    "pm10Value24": "33",
                    "pm25Grade": "-",
                    "pm25Grade1h": "-",
                    "pm25Value": "-",
                    "pm25Value24": "-",
                    "resultCode": "",
                    "resultMsg": "",
                    "rnum": 0,
                    "serviceKey": "",
                    "sidoName": "",
                    "so2Grade": "1",
                    "so2Value": "0.004",
                    "stationCode": "",
                    "stationName": "한강대로",
                    "totalCount": "",
                    "ver": ""
                }],
            "totalCount": 2
        };

        keco.parseCtprvn(data, function (err, result) {
            if(err) {
                console.error(err);
            }
            assert.equal(data.list[0].pm10Grade1h, result[0].pm10Grade);
            assert.equal(data.list[0].pm10Grade, result[0].pm10Grade24);
            assert.equal(data.list[0].pm25Grade1h, result[0].pm25Grade);
            assert.equal(data.list[0].pm25Grade, result[0].pm25Grade24);
            done();
        });
    });
});
