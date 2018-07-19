/**
 * Created by aleckim on 18. 7. 17..
 */

"use strict";

var assert  = require('assert');

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

const KmaSpecialWeatherController = require('../controllers/kma.specialweather.controller');


describe('unit test - kma special weather controller', ()=> {
    let sws = {
        "announcement": "2018-07-16T02:00:00.000Z",
        "type": 1,
        "comment": "o 폭염특보 발표구역의 일부지점 기온예보는 특보기준보다 낮을 수 있습니다.o 폭염 영향 분야 및 대응요령 폭염주의보[보건] 열사병과 탈진의 위험이 높아집니다. 낮에는 야외활동, 실외작업을 가급적 자제하기 바랍니다.[가축] 가축이 폐사하거나 산란계의 산란율이 현저하게 감소할 수 있습니다.  폭염경보[보건] 온열질환 발생 가능성이 매우 높습니다. 거동이 불편한 노약자는 가족 및 이웃이 수시로 상태를 점검하기 바랍니다.[가축] 집단 폐사할 가능성이 있습니다. 사육밀도조절, 그늘막·단열재 설치, 지속적 환기, 송풍·물분무장치 가동 등을 조치하기 바랍니다. [농업] 대량의 병충해 가능성이 있으니 대비(차광막, 스프링클러, 방역)하기 바랍니다.",
        "imageUrl": "http://www.weather.go.kr/repositary/image/wrn/img/KTKO50_201807161100_108_151.png",
        "situationList": [
            {
                "weather": 12,
                "weatherStr": "폭염",
                "level": 2,
                "levelStr": "경보",
                "info": [
                    {
                        "location": "세종,울산,부산,대구,광주,대전,서울,제주도(제주도동부),경상남도(고성,통영제외),경상북도,전라남도(장흥,화순,나주,함평,순천,광양,여수,보성,구례,곡성,담양),충청북도(제천,단양,충주,영동,옥천,괴산,보은,청주),충청남도(부여,공주),강원도(삼척평지,동해평지,홍천평지,강릉평지,양양평지,고성평지,속초평지,횡성,춘천,화천,원주),경기도(여주,군포,성남,가평,광명,양평,광주,안성,이천,용인,하남,의왕,평택,오산,남양주,구리,안양,수원,의정부,포천,부천,과천),전라북도(순창,남원,전주,정읍,익산,임실,무주,완주)"
                    }
                ]
            },
            {
                "weather": 12,
                "weatherStr": "폭염",
                "level": 1,
                "levelStr": "주의보",
                "info": [
                    {
                        "location": "울릉도.독도,인천(강화군,옹진군제외),제주도(제주도북부,제주도서부),경상남도(고성),전라남도(무안,진도,신안(흑산면제외),목포,영광,영암,완도,해남,강진,고흥,장성),충청북도(증평,음성,진천),충청남도(당진,서천,계룡,홍성,예산,청양,금산,논산,아산,천안),강원도(강원북부산지,강원중부산지,강원남부산지,양구평지,정선평지,평창평지,인제평지,철원,영월,태백),경기도(안산,화성,파주,양주,고양,연천,동두천,김포,시흥),전라북도(진안,김제,군산,부안,고창,장수)"
                    }
                ]
            }
        ]
    };

    const testList =  [
        {town: {first:"인천광역시", second:"", third:""}, result: '인천'},
        {town: {first:"인천광역시", second:"강화군", third:""}, result: null},
        {town: {first:"경상남도", second:"통영시", third:""}, result: undefined},
        {town: {first:"경상남도", second:"고성", third:""}, result: '고성'},
        {town: {first:"전라남도", second:"신안군", third:""}, result: '신안(흑산면제외)'},
        {town: {first:"제주특별자치도", second:"제주시", third:""}, stnName: "제주", result: '제주도북부'},
        {town: {first:"제주특별자치도", second:"서귀포시", third:""}, stnName: "서귀포", result: null},
        {town: {first:"경상북도", second:"울릉읍", third:""}, result: "울릉도.독도"},
    ];

    testList.forEach(obj=> {
        it ('test find location by town'+JSON.stringify(obj), ()=> {
            let kmaSpecial = new KmaSpecialWeatherController();
            let localName = kmaSpecial._findLocationByTown(obj.town, obj.stnName, sws.situationList[1].info[0].location);
            assert(localName == obj.result);
        });
    });

    it ('test sort special info list', ()=> {
        let list = [{weather: 9, weatherStr: "한파"}, {weather: 11, weatherStr: "황사"}];
        let kmaSpecial = new KmaSpecialWeatherController();
        let newList = kmaSpecial._sort(list);

        assert(newList[0].weather === 11);
    });
});
