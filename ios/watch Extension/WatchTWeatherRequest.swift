//
//  WatchTWeatherRequest.swift
//  watch Extension
//
//  Created by KwangHo Kim on 2017. 11. 6..
//

import Foundation

class WatchTWeatherRequest {
    
    let TODAYWEATHER_URL : String!                  = "https://todayweather.wizardfactory.net"
    
    let STR_DAUM_COORD2ADDR_URL : String!           = "https://apis.daum.net/local/geo/coord2addr"
    let STR_GOOGLE_COORD2ADDR_URL : String!         = "https://maps.googleapis.com/maps/api/geocode/json?latlng="
    let STR_GOOGLE_ADDR2COORD_URL : String!         = "https://maps.googleapis.com/maps/api/geocode/json?address="
    let STR_APIKEY : String!                        = "?apikey="
    let STR_LONGITUDE : String!                     = "&longitude="
    let STR_LATITUDE : String!                      = "&latitude="
    let STR_INPUT_COORD : String!                   = "&inputCoordSystem=WGS84"
    let STR_OUTPUT_JSON : String!                   = "&output=json"
    let API_JUST_TOWN : String!                     = "v000803/town"
    let WORLD_API_URL : String!                     = "ww/010000/current/2?gcode="
    
    let DAUM_SERVICE_KEY : String!                  = "6d0116e2c49361cb75eaf12f665e6360"
    
    #if false
    enum TYPE_REQUEST {
    case NONE
    case ADDR_DAUM
    case ADDR_GOOGLE
    case GEO_GOOGLE
    case WEATHER_KR
    case WEATHER_GLOBAL
    case WATCH_COMPLICATION
    case MAX
    }
    static let sharedInstance : WatchTWeatherRequest = {
    let instance = WatchTWeatherRequest()
    //setup code
    return instance
    }()
    
    #endif
    //let watchTWUtil = WatchTWeatherUtil();
    
    
    struct StaticInstance {
        static var instance: WatchTWeatherRequest?
    }
    
    class func sharedInstance() -> WatchTWeatherRequest {
        if !(StaticInstance.instance != nil) {
            StaticInstance.instance = WatchTWeatherRequest()
        }
        return StaticInstance.instance!
    }
    
    
    //    let watchTWUtil = WatchTWeatherUtil.sharedInstance();
    //    let watchTWSM = WatchTWeatherShowMore.sharedInstance();
    //    let watchTWDraw = WatchTWeatherDraw.sharedInstance();
    
    
    func makeGlobalRequestURL(locDict : NSDictionary) -> String? {
        var strURL : String? = nil;
        var strLong : String? = nil;
        var strLat : String? = nil;
        var strProcessedLat : String? = nil;
        var strProcessedLong : String? = nil;
        var nsnLat : NSNumber;
        var nsnLong : NSNumber;
        
        if (locDict["lat"] != nil) {
            nsnLat = locDict["lat"] as! NSNumber;
            strLat = NSString(format: "%@", nsnLat) as String
            //todayMaxTemp    = Int(numberTaMax.intValue);
            print("[makeGlobalRequestURL] strLat : \(String(describing: strLat))");
        } else {
            print("That nsnLat  is not in the todayDict dictionary.")
        }
        
        var arrLat : Array?     = strLat?.components(separatedBy: ".");
        var strLatTmp : String? = arrLat?[1];
        print("[makeGlobalRequestURL] nssLatTmp : \(String(describing: strLatTmp))");
        
        if (locDict["long"] != nil) {
            
            nsnLong = locDict["long"] as! NSNumber;
            strLong = NSString(format: "%@", nsnLong) as String
            //todayMaxTemp    = Int(numberTaMax.intValue);
            print("(1)[makeGlobalRequestURL] strLong : \(String(describing: strLong))");
        } else {
            print("(1)That strLong  is not in the todayDict dictionary.")
        }
        
        if(strLong == nil || strLong == "(null)")
        {
            if (locDict["lng"] != nil) {
                nsnLong = locDict["lng"] as! NSNumber;
                strLong = NSString(format: "%@", nsnLong) as String
                //todayMaxTemp    = Int(numberTaMax.intValue);
                print("(2)[makeGlobalRequestURL] strLong : \(String(describing: strLong))");
            } else {
                print("(2)That strLong  is not in the todayDict dictionary.")
            }
        }
        
        print("strLat : \(String(describing: strLat))");
        print("strLong : \(String(describing: strLong))");
        
        if( strLatTmp?.characters.count != 2)
        {
            strProcessedLat   = watchTWUtil.processLocationStr(strSrcStr: strLat);
            strProcessedLong  = watchTWUtil.processLocationStr(strSrcStr: strLong);
        }
        else
        {
            strProcessedLat   = strLat;
            strProcessedLong  = strLong;
        }
        
        // Ex: https://todayweather.wizardfactory.net/ww/010000/current/2?gcode=40.71,-74.00
        //strURL = NSString(format: "%@/%@%@,%@", TODAYWEATHER_URL, WORLD_API_URL, strProcessedLat!, strProcessedLong!) as String;
        //strURL = NSString(format: "%s/%s%s,%s", TODAYWEATHER_URL, WORLD_API_URL, strProcessedLat!, strProcessedLong!) as String;
        strURL = TODAYWEATHER_URL + "/" + WORLD_API_URL + strProcessedLat! + "," + strProcessedLong!;
        
        if(strURL == nil)
        {
            print("nssURL is nil!!!");
            return nil;
        }
        
        return strURL;
    }
    
    func makeRequestURL(addr1 : String?, addr2 : String?, addr3 : String?, country : String ) -> String {
        var URL : String = watchTWReq.TODAYWEATHER_URL + "/" + watchTWReq.API_JUST_TOWN;
        let set : CharacterSet = CharacterSet.urlQueryAllowed;
        
        if (addr1 != nil) {
            URL = URL + "/" + addr1!;
        }
        if (addr2 != nil) {
            URL = URL + "/" + addr2!;
        }
        if (addr3 != nil) {
            URL = URL + "/" + addr3!;
        }
        
        #if USE_DEBUG
            print("before URL => \(URL)");
        #endif
        
        URL = URL.addingPercentEncoding(withAllowedCharacters: set)!;
        #if USE_DEBUG
            print("after URL => \(URL)");
        #endif
        
        return URL;
    }
    
    
    
    #if false
    func requestAsyncByURLSession( url : String, reqType : TYPE_REQUEST) {
    print("[requestAsyncByURLSession] url : \(url)");
    let strURL : URL! = URL(string: url);
    
    print("[requestAsyncByURLSession] url : \(strURL), request type : \(reqType)");
    
    var request = URLRequest.init(url: strURL);
    
    if( reqType == TYPE_REQUEST.WEATHER_KR) {
    request.setValue("ko-kr,ko;q=0.8,en-us;q=0.5,en;q=0.3", forHTTPHeaderField: "Accept-Language");
    }
    
    let task = URLSession.shared.dataTask(with: request, completionHandler: {(data, response, error) -> Void in
    if let data = data {
    // Do stuff with the data
    //print("data : \(data)");
    self.makeJSON( with : data, type : reqType);
    } else {
    print("Failed to fetch \(strURL) : \(String(describing: error))");
    }
    })
    
    task.resume();
    }
    
    
    func makeJSON( with jsonData : Data, type reqType : TYPE_REQUEST) {
    do {
    guard let parsedResult = try JSONSerialization.jsonObject(with: jsonData, options: .allowFragments) as? NSDictionary else {
    return
    }
    //print("Parsed Result: \(parsedResult)")
    
    if(reqType == TYPE_REQUEST.ADDR_DAUM)
    {
    //[self parseKRAddress:jsonDict];
    }
    else if(reqType == TYPE_REQUEST.ADDR_GOOGLE)
    {
    //[self parseGlobalAddress:jsonDict];
    }
    else if(reqType == TYPE_REQUEST.GEO_GOOGLE)
    {
    //[self parseGlobalGeocode:jsonDict];
    }
    else if(reqType == TYPE_REQUEST.WEATHER_KR)
    {
    //watchTWDraw = WatchTWeatherDraw.sharedInstance();
    print("reqType == TYPE_REQUEST.WEATHER_KR");
    //[self saveWeatherInfo:jsonDict];
    //sharedInterCont.processWeatherResultsWithShowMore(jsonDict: parsedResult as? Dictionary<String, AnyObject>)
    //let interCont = InterfaceController();
    sharedInterCont.processWeatherResultsWithShowMore(jsonDict: parsedResult as? Dictionary<String, AnyObject>)
    //[self processRequestIndicator:TRUE];
    }
    else if(reqType == TYPE_REQUEST.WEATHER_GLOBAL)
    {
    //watchTWDraw = WatchTWeatherDraw.sharedInstance();
    print("reqType == WEATHER_GLOBAL");
    //[self saveWeatherInfo:jsonDict];
    
    sharedInterCont.processWeatherResultsAboutGlobal(jsonDict: parsedResult as? Dictionary<String, AnyObject>)
    //[self processRequestIndicator:TRUE];
    }
    else if(reqType == TYPE_REQUEST.WATCH_COMPLICATION)
    {
    print("reqType == WATCH_COMPLICATION");
    }
    
    } catch {
    print("Error: \(error.localizedDescription)")
    }
    }
    #endif
    
}

