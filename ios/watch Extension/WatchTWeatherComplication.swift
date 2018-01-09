//
//  WatchTWeatherComplication.swift
//  watch Extension
//
//  Created by KwangHo Kim on 2017. 10. 27..
//

import Foundation
import ClockKit
import WatchKit




class WatchTWeatherComplication: NSObject, CLKComplicationDataSource, CLLocationManagerDelegate {
    var strCurImgName : String = "Sun"; // Current Weather status image
    
    var strAddress : String = "";         // Address
    var currentTemp : Float = 0;            // Current Temperature
    
    var strAirState : String = "";          // Air state or Huminity
    var colorAirState : UIColor =  UIColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1)
    var attrStrAirState : NSAttributedString = NSAttributedString();
    
    
    var todayPop : Int = 0;
    var todayMinTemp : Int = 0;
    var todayMaxTemp : Int = 0;
    
    var isTimeReloaded : Bool = false
    var isWeatherRequested : Bool = false
    
    // Location Infomation
    var manager: CLLocationManager = CLLocationManager()
    var curLatitude : Double = 0;
    var curLongitude : Double = 0;
    
    #if false
    struct CityInfo {
    var identifier : Any;
    var strAddress : String;
    var currentPosition : Bool;
    var index : Int;
    var weatherData : Dictionary<String, Any>;
    var name : String;
    var country : String;
    var dictLocation : Dictionary<String, Any>;
    
    init() {
    identifier = "cityInfoID"
    strAddress = "";
    currentPosition = true;
    index = 0;
    weatherData = [:];
    name = "name"
    country = "KR"
    dictLocation = [:];
    }
    }
    #endif
    
    //var currentCity : CityInfo? = nil;
    var currentCity = CityInfo();
    
    //var shuffledDaumKeys : NSMutableArray = [String]() as! NSMutableArray;
    var shuffledDaumKeys : NSMutableArray = NSMutableArray();
    //var nextDate: Date?
    
    
    func getSupportedTimeTravelDirections(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationTimeTravelDirections) -> Void) {
        print("getSupportedTimeTravelDirections");
        
        handler([])
    }
    
    func getTimelineStartDate(for complication: CLKComplication, withHandler handler: @escaping (Date?) -> Void) {
        print("getTimelineStartDate");
        
        handler(nil)
    }
    
    func getTimelineEndDate(for complication: CLKComplication, withHandler handler: @escaping (Date?) -> Void) {
        print("getTimelineEndDate");
        
        handler(nil)
    }
    
    func getPrivacyBehavior(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationPrivacyBehavior) -> Void) {
        print("getPrivacyBehavior");
        
        handler(.showOnLockScreen)
    }
    
    func getCurrentTimelineEntry(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationTimelineEntry?) -> Void) {
        print("getCurrentTimelineEntry")
        
        
        var entry: CLKComplicationTimelineEntry?
        //let timestamp = UserDefaults.standard.double(forKey: "timeStamp")
        //let date = Date(timeIntervalSince1970: timestamp)
        //nextDate = date
        
        // Call the handler with the current timeline entry
        switch  complication . family  {
            
        case .modularSmall :
            print("modularSmall")
            let curImage = UIImage(named: "\(String(describing: strCurImgName))")
            print("\(strCurImgName)")
            #if false
                let  template  =  CLKComplicationTemplateModularSmallSimpleImage ()
                if(curImage != nil) {
                    print("current Image is existed!!!")
                    template.imageProvider = CLKImageProvider(onePieceImage: curImage!)
                }
            #endif
            let template = CLKComplicationTemplateModularSmallStackImage()
            if(curImage != nil) {
                print("current Image is existed!!!")
                template.line1ImageProvider = CLKImageProvider(onePieceImage: curImage!)
            }
            
            print("country : \(currentCity.country)")
            
            if( (currentCity.country == "KR" ) ||
                (currentCity.country == "(null)" )
                // (currentCity.country == nil)
                ) {
                //template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(attrStrAirState)")
                template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(strAirState)")
                //template.tintColor = colorAirState;
            } else {
                template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚")
            }
            
            handler ( CLKComplicationTimelineEntry ( date :  Date (),  complicationTemplate :  template ))
            
        case .modularLarge :
            #if false
                
                print("modularLarge")
                let template = CLKComplicationTemplateModularLargeStandardBody()
                
                print("\(String(describing: strAddress))")
                
                template.headerTextProvider = CLKSimpleTextProvider(text: "\(todayPop)% \(String(describing: strAddress)) \(currentTemp)˚")
                template.body1TextProvider = CLKSimpleTextProvider(text: "\(String(describing:strAirState))")
                template.body2TextProvider = CLKSimpleTextProvider(text: "\(todayMinTemp)˚ / \(todayMaxTemp)˚")
                
                let strUmbImgName : String = "Umbrella"; // Current Weather status image
                let umbImage = UIImage(named: String(describing: strUmbImgName))
                if(umbImage != nil ) {
                    template.headerImageProvider = CLKImageProvider(onePieceImage: umbImage!)
                }
                
                template.tintColor = colorAirState;
                
                entry = CLKComplicationTimelineEntry(date: Date(), complicationTemplate: template)
                
                handler(entry)
            #endif
            
        case .utilitarianSmall :
            let curImage = UIImage(named: "\(String(describing: strCurImgName))")
            let template = CLKComplicationTemplateUtilitarianSmallFlat()
            
            if(curImage != nil) {
                print("current Image is existed!!!")
                template.imageProvider = CLKImageProvider(onePieceImage: curImage!)
            }
            
            if( (currentCity.country == "KR" ) ||
                (currentCity.country == "(null)" )
                // (currentCity.country == nil)
                ) {
                //template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(attrStrAirState)")
                template.textProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(strAirState)")
                //template.tintColor = colorAirState;
            } else {
                template.textProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚")
            }
            
            handler ( CLKComplicationTimelineEntry ( date :  Date (),  complicationTemplate :  template ))
            
        case .circularSmall :
            let curImage = UIImage(named: "\(String(describing: strCurImgName))")
            let template = CLKComplicationTemplateCircularSmallStackImage()
            
            if(curImage != nil) {
                print("current Image is existed!!!")
                template.line1ImageProvider = CLKImageProvider(onePieceImage: curImage!)
            }
            
            if( (currentCity.country == "KR" ) ||
                (currentCity.country == "(null)" )
                // (currentCity.country == nil)
                ) {
                //template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(attrStrAirState)")
                template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(strAirState)")
                //template.tintColor = colorAirState;
            } else {
                template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚")
            }
            
            handler ( CLKComplicationTimelineEntry ( date :  Date (),  complicationTemplate :  template ))
            
        case .extraLarge :
            let curImage = UIImage(named: "\(String(describing: strCurImgName))")
            let template = CLKComplicationTemplateExtraLargeStackImage()
            
            if(curImage != nil) {
                print("current Image is existed!!!")
                template.line1ImageProvider = CLKImageProvider(onePieceImage: curImage!)
            }
            
            if( (currentCity.country == "KR" ) ||
                (currentCity.country == "(null)" )
                // (currentCity.country == nil)
                ) {
                //template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(attrStrAirState)")
                template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚ \(strAirState)")
                //template.tintColor = colorAirState;
            } else {
                template.line2TextProvider = CLKSimpleTextProvider(text: "\(currentTemp)˚")
            }
            
            
            handler ( CLKComplicationTimelineEntry ( date :  Date (),  complicationTemplate :  template ))
            
            
        default :
            print ( "Unknown complication type: \(complication.family) " )
            handler ( nil )
        }
    }
    
    func getCurrentHealth() -> Int {
        // This would be used to retrieve current Chairman Cow health data
        // for display on the watch. For testing, this always returns a
        // constant.
        return 4
    }
    
    func getNextRequestedUpdateDateWithHandler(handler: (NSDate?) -> Void) {
        // Update hourly
        
        handler(NSDate(timeIntervalSinceNow: 60*60))
        print("getNextRequestedUpdateDateWithHandler");
    }
    
    func getPlaceholderTemplateForComplication(complication: CLKComplication, withHandler handler: (CLKComplicationTemplate?) -> Void) {
        print("getPlaceholderTemplateForComplication");
        #if false
            var template: CLKComplicationTemplate? = nil
            switch complication.family {
            case .modularSmall:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "abc--")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("modularSmall");
            case .modularLarge:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "def--")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("modularLarge");
            case .utilitarianSmall:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "------")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("utilitarianSmall");
            case .utilitarianSmallFlat:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "------")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("utilitarianSmallFlat");
            case .utilitarianLarge:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "------")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("utilitarianLarge");
            case .circularSmall:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "------")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("circularSmall");
            case .extraLarge:
                let modularTemplate = CLKComplicationTemplateCircularSmallRingText()
                modularTemplate.textProvider = CLKSimpleTextProvider(text: "------")
                modularTemplate.fillFraction = 1
                modularTemplate.ringStyle = CLKComplicationRingStyle.closed
                template = modularTemplate
                print("extraLarge");
            }
            handler(template)
        #endif
        handler(defaultTemplate())
    }
    
    func defaultTemplate() -> CLKComplicationTemplateModularLargeStandardBody {
        let placeholder = CLKComplicationTemplateModularLargeStandardBody();
        placeholder.headerTextProvider = CLKSimpleTextProvider(text: "Transit")
        placeholder.body1TextProvider = CLKSimpleTextProvider(text: "Next bus in:")
        placeholder.body2TextProvider = CLKSimpleTextProvider(text: "")
        return placeholder
    }
    
    func getCurrentTimelineEntryForComplication(complication: CLKComplication, withHandler handler: (CLKComplicationTimelineEntry?) -> Void) {
        print("getCurrentTimelineEntryForComplication")
        
        if complication.family == .modularSmall {
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "modularSmall")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
        } else if complication.family == .modularLarge {
            
            //CLKComplicationTemplateModularLargeStandardBody *t = [[CLKComplicationTemplateModularLargeStandardBody alloc] init];
            //t.headerTextProvider = [CLKSimpleTextProvider textProviderWithText:data[@"Waxing gibbous"]];
            //t.body1TextProvider = [CLKSimpleTextProvider textProviderWithText:data[@"Moonrise 5:27PM"]];
            //t.body2TextProvider = [CLKTimeIntervalTextProvider textProviderWithStartDate:[NSDate date] endDate:[NSDate dateWithTimeIntervalSinceNow:((6*60*60)+(18*60))];
            
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "modularLarge")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
            
            
        } else if complication.family == .utilitarianSmall {
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "utilitarianSmall")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
        } else if complication.family == .utilitarianSmallFlat {
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "utilitarianSmallFlat")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
        } else if complication.family == .utilitarianLarge {
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "utilitarianLarge")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
        } else if complication.family == .circularSmall {
            let template = CLKComplicationTemplateCircularSmallRingText()
            //template.textProvider = CLKSimpleTextProvider(text: "\(getCurrentHealth())")
            template.textProvider = CLKSimpleTextProvider(text: "circularSmall")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
        } else if complication.family == .extraLarge {
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "extraLarge")
            template.fillFraction = Float(getCurrentHealth()) / 10.0
            template.ringStyle = CLKComplicationRingStyle.closed
            
            let timelineEntry = CLKComplicationTimelineEntry(date: NSDate() as Date, complicationTemplate: template)
            handler(timelineEntry)
        } else {
            handler(nil)
        }
    }
    
    func getTimelineEntries(for complication: CLKComplication, before date: Date, limit: Int, withHandler handler: @escaping ([CLKComplicationTimelineEntry]?) -> Void) {
        // Call the handler with the timeline entries prior to the given date
        print("getTimelineEntries before");
        
        handler(nil)
    }
    
    func getTimelineEntries(for complication: CLKComplication, after date: Date, limit: Int, withHandler handler: @escaping ([CLKComplicationTimelineEntry]?) -> Void) {
        // Call the handler with the timeline entries after to the given date
        print("getTimelineEntries after date : \(date) limit : \(limit)");
        
        if( isTimeReloaded == false) {
            let defaults = UserDefaults(suiteName: "group.net.wizardfactory.todayweather")
            defaults?.synchronize()
            
            if defaults == nil {
                print("defaults is nuil!")
            } else {
                print(defaults!)
            }
            
            if let units = defaults?.string(forKey: "units") {
                print(units)
                watchTWUtil.setTemperatureUnit(strUnits: units);
            }
            
            if let daumKeys = defaults?.string(forKey: "daumServiceKeys") {
                print(daumKeys)
                watchTWUtil.setDaumServiceKeys(strDaumKeys: daumKeys);
            }
            
            // test - FIXME
            
            var nextCity : CityInfo? = CityInfo();
            print("nextCity : \(String(describing: nextCity))");
            
            currentCity = CityInfo.loadCurrentCity();
            
            #if false
                nextCity?.currentPosition = true;
                nextCity?.country = "KR";
                print("nextCity : \(String(describing: nextCity))");
                let archivedObject : NSData = NSKeyedArchiver.archivedData(withRootObject: nextCity!) as NSData;
                print("archivedObject : \(String(describing: archivedObject))");
                defaults?.set(archivedObject, forKey: "currentCity")
                defaults?.synchronize();
                
                
                if let archivedObject = defaults?.object(forKey: "currentCity") {
                    print("archivedObject : \(archivedObject)");
                    //currentCity = (CityInfo *)[NSKeyedUnarchiver unarchiveObjectWithData:archivedObject];
                    //currentCity = (NSKeyedUnarchiver.unarchiveObject(with: archivedObject as! Data) as? CityInfo)!;
                    currentCity = NSKeyedUnarchiver.unarchiveObject(with: (archivedObject as! Data)) as! WatchTWeatherComplication.CityInfo ;
                    if (currentCity == nil) {
                        print("UnarchiveObjectWithData is failed!!!")
                    }
                    else {
                        print("Current City : \(String(describing: currentCity))");
                    }
                    
                } else {
                    print("Current City is not existed!!!")
                }
            #endif
            
            print("currentPosition : \(String(describing: currentCity.currentPosition))")
            print("country : \(String(describing: currentCity.country))")
            print("strAddress : \(String(describing: currentCity.strAddress))")
            print("dictLocation : \(String(describing: currentCity.dictLocation))")
   
            #if true
                if (currentCity.currentPosition == true){
                    //manager.delegate = self
                    //manager.desiredAccuracy = kCLLocationAccuracyBest;
                    // Update if you move 200 meter
                    //manager.distanceFilter = 200;
                    //manager.allowsBackgroundLocationUpdates = true;
                    //manager.requestAlwaysAuthorization();
                    //manager.requestWhenInUseAuthorization
                    //manager.startUpdatingLocation();
                    //manager.requestLocation()
                    
                    // Temporally use loaded data. after request location successfully, we will change
                    if( (currentCity.country == "KR" ) ||
                        (currentCity.country == "(null)" )
                        // (currentCity.country == nil)
                        )
                    {
                        print("strAddress : \(String(describing: currentCity.strAddress))")
                        processKRAddress((currentCity.strAddress)!);
                    }
                    else
                    {
                        //let keys = ["lat", "lng"];
                        //let values = [40.71, -74.00];
                        //let dict = NSDictionary.init(objects: values, forKeys: keys as [NSCopying])
                        processGlobalAddressForComplicaton(location: currentCity.dictLocation as NSDictionary?);
                    }
                }
                else
                {
                    if( (currentCity.country == "KR" ) ||
                        (currentCity.country == "(null)" )
                        // (currentCity.country == nil)
                        )
                    {
                        print("strAddress : \(String(describing: currentCity.strAddress))")
                        processKRAddress((currentCity.strAddress)!);
                    }
                    else
                    {
                        //let keys = ["lat", "lng"];
                        //let values = [40.71, -74.00];
                        //let dict = NSDictionary.init(objects: values, forKeys: keys as [NSCopying])
                        processGlobalAddressForComplicaton(location: currentCity.dictLocation as NSDictionary?);
                    }
                }
            #endif
            
            isTimeReloaded = true;
        }
        
        handler(nil)
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("error:: \(error.localizedDescription)")
    }
    
    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        if status == .authorizedWhenInUse {
            manager.requestLocation()
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        //NSDate* eventDate = newLocation.timestamp;
        //NSTimeInterval    howRecent = [eventDate timeIntervalSinceNow];
        print("location:: \(locations)")
        if locations.first != nil {
            print("location:: \(locations)")
            
            //if(fabs(howRecent) < 5.0)
            //{
            //[locationManager stopUpdatingLocation];
            
            curLatitude     = (locations.last?.coordinate.latitude)!;
            curLongitude    = (locations.last?.coordinate.longitude)!;
            
            print("[locationManager] latitude : %f, longitude : %f", curLatitude, curLongitude)
            
            getAddressFromGoogle(latitude: curLatitude, longitude: curLongitude);
            
            //}
            
            #if false
                self.lat = String(format:"%.4f", (locations.last?.coordinate.latitude)!)
                self.lon = String(format:"%.4f", (locations.last?.coordinate.longitude)!)
                let geoCoder = CLGeocoder()
                geoCoder.reverseGeocodeLocation(locations.last!, completionHandler: { (placemarks, error) -> Void in
                    guard let placeMark: CLPlacemark = placemarks?[0] else {
                        return
                    }
                    guard let state = placeMark.administrativeArea as String! else {
                        return
                    }
                    self.state = state
                })
            #endif
        }
    }
    
    #if false
    func requestedUpdateDidBegin(){
    print("requestedUpdateDidBegin");
    manager.delegate = self
    manager.requestLocation()
    let server=CLKComplicationServer.sharedInstance()
    for comp in (server.activeComplications)! {
    server.reloadTimeline(for: comp)
    }
    }
    #endif
    
    var backgroundUrlSession:URLSession?
    var pendingBackgroundURLTask:WKURLSessionRefreshBackgroundTask?
    
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        print("#### WKRefreshBackgroundTask ####")
        manager.delegate = self
        manager.requestLocation()
        
        for task in backgroundTasks {
            if let refreshTask = task as? WKApplicationRefreshBackgroundTask {
                // this task is completed below, our app will then suspend while the download session runs
                print("application task received, start URL session, WKApplicationRefreshBackgroundTask")
                
                manager.delegate = self
                manager.requestLocation()
                
                
            }
            else if let urlTask = task as? WKURLSessionRefreshBackgroundTask
            {
                print("application task received, start URL session, WKURLSessionRefreshBackgroundTask")
                
                manager.delegate = self
                manager.requestLocation()
            } else {
                print("else")
                manager.delegate = self
                manager.requestLocation()
            }
        }
    }
    
    func getAddressFromGoogle(latitude:Double, longitude: Double)
    {
        //40.7127837, -74.0059413 <- New York
        
        #if false //GLOBAL_TEST
            // FIXME - for emulator - delete me
            //let lat : Double    = 40.7127837;
            //let longi : Double  = -74.0059413;
            
            // 오사카
            //float lat = 34.678395;
            //float longi = 135.4601303;
            
            //
            let lat : Double    = 37.5665350;
            let longi : Double  = 126.9779690;
            
            curLatitude = lat;
            curLongitude = longi;
            
            //https://maps.googleapis.com/maps/api/geocode/json?latlng=40.7127837,-74.0059413
            
            let strURL : String = String(format:"%@%f,%f", watchTWReq.STR_GOOGLE_COORD2ADDR_URL, lat, longi);
        #else
            let strURL : String = String(format:"%s%f,%f", watchTWReq.STR_GOOGLE_COORD2ADDR_URL, latitude, longitude);
        #endif
        
        print("[getAddressFromGoogle]url : \(strURL)");
        
        requestAsyncByURLSession(url:strURL, reqType:InterfaceController.TYPE_REQUEST.ADDR_GOOGLE);
    }
    
    func processKRAddress( _ address : String) {
        let array = address.characters.split(separator: " ").map(String.init)
        var addr1 : String? = nil;
        var addr2 : String? = nil;
        var addr3 : String? = nil;
        var lastChar : String? = nil;
        
        print("array.count => \(array.count)");
        
        if(array.count == 0) {
            print("address is empty!!!");
            return
        }
        
        if (array.count == 2) {
            addr1 = array[1]
        }
        else if (array.count == 5) {
            addr1 = array[1];
            addr2 = array[2] + array[3];
            addr3 = array[4];
        }
        else if (array.count == 4) {
            let index : Int = array[3].characters.count - 1;
            addr1 = array[1];
            lastChar = (array[3] as NSString).substring(from:index);
            if ( lastChar == "구" ) {
                addr2 = array[2] + array[3];
            }
            else {
                addr2 = array[2];
                addr3 = array[3];
            }
        }
        else if ( array.count == 3) {
            let index : Int = array[2].characters.count - 1;
            addr1 = array[1];
            lastChar = (array[2] as NSString).substring(from:index);
            if ( lastChar == "읍" ) || ( lastChar == "면" ) || ( lastChar == "동" ) {
                addr2 = array[1];
                addr3 = array[2];
            }
            else {
                addr2 = array[2];
            }
        }
        
        dump(array);
        print("[processKRAddress] =>  addr1:\(String(describing: addr1)), addr2:\(String(describing: addr2)), addr3:\(String(describing: addr3))");
        let URL = watchTWReq.makeRequestURL(addr1:addr1!, addr2:addr2!, addr3:addr3!, country:"KR");
        requestAsyncByURLSession(url:URL, reqType:InterfaceController.TYPE_REQUEST.WEATHER_KR);
        //print("nssURL : %s", nssURL);
    }
    
    
    func processGlobalAddressForComplicaton(location : NSDictionary?) {
        if let strURL : String = watchTWReq.makeGlobalRequestURL(locDict : location!) {
            requestAsyncByURLSession(url:strURL, reqType:InterfaceController.TYPE_REQUEST.WEATHER_GLOBAL);
            
            print("[processGlobalAddressForComplicaton] strURL : \(strURL)");
        }
    }
    
    func requestAsyncByURLSession( url : String, reqType : InterfaceController.TYPE_REQUEST) {
        print("url : \(url)");
        let strURL : URL! = URL(string: url);
        
        print("[requestAsyncByURLSession] url : \(strURL), request type : \(reqType)");
        
        var request = URLRequest.init(url: strURL);
        if( reqType == InterfaceController.TYPE_REQUEST.WEATHER_KR) {
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
    
    func requestAsyncByURLSessionForRetry( url : String, reqType : InterfaceController.TYPE_REQUEST, nsdData:NSDictionary) {
        let strURL : URL! = URL(string: url);
        
        print("[requestAsyncByURLSession] url : \(strURL), request type : \(reqType)");
        
        var request = URLRequest.init(url: strURL);
        if( reqType == InterfaceController.TYPE_REQUEST.WEATHER_KR) {
            request.setValue("ko-kr,ko;q=0.8,en-us;q=0.5,en;q=0.3", forHTTPHeaderField: "Accept-Language");
        }
        
        let task = URLSession.shared.dataTask(with: request, completionHandler: {(data, response, error) -> Void in
            if let data = data {
                // Do stuff with the data
                //print("data : \(data)");
                let httpResponse :HTTPURLResponse = response as! HTTPURLResponse;
                let code : Int = Int(httpResponse.statusCode);
                if( (code == 401) || (code == 429) ) {
                    print("key is not authorized or keys is all used. retry!!! nsdData : \(nsdData)");
                    let lat = Double(nsdData["latitude"] as! String);
                    let long = Double(nsdData["longitude"] as! String);
                    let count = Int(nsdData["tryCount"] as! String);
                    self.getAddressFromDaum(latitude: lat!, longitude:long!, tryCount:count!);
                } else {
                    self.makeJSON( with : data, type : reqType);
                }
            } else {
                print("Failed to fetch \(strURL) : \(String(describing: error))");
            }
        })
        
        task.resume();
    }
    
    func parseKRAddress(jsonDict : NSDictionary) {
        var dict : NSDictionary? = nil;
        var strFullName : String;
        var strName : String;
        var strName0 : String;
        var strName1 : String;
        var strName2 : String;
        var strName3 : String;
        var strURL : String? = nil;
        
        dict = jsonDict.object(forKey:"error") as? NSDictionary;
        print("error dict : \(String(describing: dict))");
        
        if(dict != nil)
        {
            print("error message : %s", dict?.object(forKey:"message") as! String);
        }
        else
        {
            print("I am valid json data!!!");
            
            strFullName = jsonDict.object(forKey:"fullName") as! String;
            strName = jsonDict.object(forKey:"name") as! String;
            strName0 = jsonDict.object(forKey:"name0") as! String;
            strName1 = jsonDict.object(forKey:"name1") as! String;
            strName2 = jsonDict.object(forKey:"name2") as! String;
            strName3 = jsonDict.object(forKey:"name3") as! String;
            
            var strName22 : String = strName2.replacingOccurrences(of: " ", with: "");
            
            #if USE_DEBUG
                print("nssFullName : %s", strFullName);
                print("nssName : %s", strName);
                print("nssName0 : %s", strName0);
                print("nssName1 : %s", strName1);
                print("nssName22 : %s", strName22);
                print("nssName3 : %s", strName3);
            #endif
            
            strURL = watchTWReq.makeRequestURL(addr1:strName1, addr2:strName22, addr3:strName3, country:"KR");
            
            requestAsyncByURLSession(url:strURL!, reqType:InterfaceController.TYPE_REQUEST.WEATHER_KR);
        }
    }
    
    func parseGlobalGeocode(jsonDict : NSDictionary?) {
        if(jsonDict == nil) {
            print("[parseGlobalGeocode] jsonDict is nil!");
            return;
        }
        
        let strStatus : String = jsonDict!.object(forKey:"status") as! String;
        if(strStatus != "OK") {
            print("strStatus[\(strStatus)] is not OK");
            return;
        }
        
        //print("jsonDict : \(jsonDict)" );
        
        if let arrResults : NSArray = jsonDict!.object(forKey:"results") as? NSArray{
            print("[parseGlobalGeocode] arrResults is \(arrResults)");
            if(arrResults.count <= 0) {
                print("[parseGlobalGeocode] arrResults is 0 or less than 0!!!");
                return;
            }
            
            let dictResults : NSDictionary = arrResults[0] as! NSDictionary;
            
            //print("dictResults : \(dictResults)");
            
            let dictGeometry : NSDictionary? = dictResults.object(forKey: "geometry") as? NSDictionary;
            if(dictGeometry == nil) {
                print("[parseGlobalGeocode] dictGeometry is nil!");
                return;
            }
            
            //print("nsdGeometry : \(nsdGeometry)";
            
            let dictLocation : NSDictionary? = dictGeometry?.object(forKey:"location") as? NSDictionary;
            if(dictLocation == nil) {
                print("[parseGlobalGeocode] nsdLocation is nil!");
                return;
            }
            //[self updateCurLocation:nsdLocation];
            
            print("dictLocation : \(String(describing: dictLocation))");
            
            processGlobalAddressForComplicaton(location: dictLocation);
            
            
        } else {
            print("[parseGlobalGeocode] nsdResults is nil!");
            return;
        }
        
    }
    
    func makeJSON( with jsonData : Data, type reqType : InterfaceController.TYPE_REQUEST) {
        do {
            guard let parsedResult = try JSONSerialization.jsonObject(with: jsonData, options: .allowFragments) as? NSDictionary else {
                return
            }
            //print("Parsed Result: \(parsedResult)")
            
            if(reqType == InterfaceController.TYPE_REQUEST.ADDR_DAUM) {
                parseKRAddress(jsonDict: (parsedResult as NSDictionary));
            }
            else if(reqType == InterfaceController.TYPE_REQUEST.ADDR_GOOGLE) {
                parseGoogleAddress(jsonDict: (parsedResult as? Dictionary<String, AnyObject>)!);
            }
            else if(reqType == InterfaceController.TYPE_REQUEST.GEO_GOOGLE) {
                parseGlobalGeocode(jsonDict: (parsedResult as NSDictionary));
            }
            else if(reqType == InterfaceController.TYPE_REQUEST.WEATHER_GLOBAL) {
                print("reqType == WATCH_COMPLICATION_GLOBAL");
                processWeatherResultsAboutCompGlobal(jsonDict: parsedResult as? Dictionary<String, AnyObject>)
                if(isWeatherRequested == false) {
                    refreshComplications();
                    isWeatherRequested = true;
                }
            }
            else if(reqType == InterfaceController.TYPE_REQUEST.WEATHER_KR) {
                print("reqType == WEATHER_KR");
                processWeatherResultsWithCompKR(jsonDict: parsedResult as? Dictionary<String, AnyObject>)
                if(isWeatherRequested == false) {
                    refreshComplications();
                    isWeatherRequested = true;
                }
            }
            
            
        } catch {
            print("Error: \(error.localizedDescription)")
        }
    }
    
    
    
    func parseGoogleAddress(jsonDict : Dictionary<String, Any>)
    {
        //print("\(jsonDict)");
        let strStatus : String         = jsonDict["status"] as! String;
        if(strStatus != "OK") {
            print("strStatus[\(strStatus)] is not OK");
            return;
        }
        
        let arrResults : NSArray         = jsonDict["results"] as! NSArray;
        
        //print("\(arrResults)");
        
        var arrSubLevel2Types : Array  = ["political", "sublocality", "sublocality_level_2"];
        var arrSubLevel1Types : Array  = ["political", "sublocality", "sublocality_level_1"];
        var arrLocalTypes : Array      = ["locality", "political"];
        let strCountryTypes : String   = String(format:"country");
        
        var strSubLevel2Name : String? = nil;
        var strSubLevel1Name : String? = nil;
        var strLocalName     : String? = nil;
        var strCountryName   : String? = nil;
        
        for i in 0 ..< arrResults.count {
            let dictResult : NSDictionary? = arrResults[i] as? NSDictionary;
            if(dictResult == nil) {
                print("nsdResult is null!!!");
                continue;
            }
            
            //print("\(i) \(String(describing: dictResult))");
            
            let arrAddressComponents : NSArray = dictResult?.object(forKey:"address_components") as! NSArray;
            for j in 0 ..< arrAddressComponents.count {
                var strAddrCompType0 : String? = nil;
                var strAddrCompType1 : String? = nil;
                var strAddrCompType2 : String? = nil;
                
                let dictAddressComponent : NSDictionary = arrAddressComponents[j] as! NSDictionary;
                let arrAddrCompTypes : NSArray     = dictAddressComponent.object(forKey:"types") as! NSArray;
                
                for k in 0 ..< arrAddrCompTypes.count {
                    if(k == 0) {
                        strAddrCompType0    = arrAddrCompTypes[k] as? String;
                    }
                    
                    if(k == 1) {
                        strAddrCompType1    = arrAddrCompTypes[k] as? String;
                    }
                    
                    if(k == 2) {
                        strAddrCompType2    = arrAddrCompTypes[k] as? String;
                    }
                }
                
                if(strAddrCompType0 == nil) {
                    strAddrCompType0 = String(format:"emptyType");
                }
                
                if(strAddrCompType1 == nil) {
                    strAddrCompType1 = String(format:"emptyType");
                }
                
                if(strAddrCompType2 == nil) {
                    strAddrCompType2 = String(format:"emptyType");
                }
                
                if ( ( strAddrCompType0 == arrSubLevel2Types[0] )
                    && ( strAddrCompType1 == arrSubLevel2Types[1] )
                    && ( strAddrCompType2 == arrSubLevel2Types[2] ) ) {
                    strSubLevel2Name = dictAddressComponent.object(forKey: "short_name") as? String;
                }
                
                if ( (strAddrCompType0 == arrSubLevel1Types[0] )
                    && ( strAddrCompType1 == arrSubLevel1Types[1] )
                    && ( strAddrCompType2 == arrSubLevel1Types[2] ) ) {
                    strSubLevel1Name = dictAddressComponent.object(forKey: "short_name") as? String;
                }
                
                if ( (strAddrCompType0 == arrLocalTypes[0] )
                    && ( strAddrCompType1 == arrLocalTypes[1] ) ) {
                    strLocalName = dictAddressComponent.object(forKey: "short_name") as? String;
                }
                
                if (strAddrCompType0 == strCountryTypes ) {
                    strCountryName = dictAddressComponent.object(forKey: "short_name") as? String;
                }
                
                if ((strSubLevel2Name != nil) && (strSubLevel1Name != nil)
                    && (strLocalName != nil) && (strCountryName != nil) ) {
                    break;
                }
            }
            
            if ((strSubLevel2Name != nil) && (strSubLevel1Name != nil)
                && (strLocalName != nil) && (strCountryName != nil) ) {
                break;
            }
        }
        
        var strName : String? = nil;
        var strAddress : String = String(format:"");
        
        print("strSubLevel2Name : \(String(describing: strSubLevel2Name))");
        print("strSubLevel1Name : \(String(describing: strSubLevel1Name))");
        print("strLocalName : \(String(describing: strLocalName))");
        print("strCountryName : \(String(describing: strCountryName))");
        
        //국내는 동단위까지 표기해야 함.
        if (strCountryName == "KR") {
            if (strSubLevel2Name != nil) {
                //strAddress  = String(format:"%s", strSubLevel2Name!);
                //strName     = String(format:"%s", strSubLevel2Name!);
                strAddress  = strSubLevel2Name!;
                strName  = strSubLevel2Name!;
            }
        }
        
        print("[parseGlobalAddress] 1 strAddress : \(String(describing: strAddress))");
        
        if (strSubLevel1Name != nil) {
            //strAddress  = String(format:"%s %s", strAddress, strSubLevel1Name!);
            strAddress  = strAddress + " " + strSubLevel1Name!;
            if (strName == nil)
            {
                //strName     = String(format:"%s", strSubLevel1Name!);
                strName     = strSubLevel1Name!;
            }
        }
        
        print("[parseGlobalAddress] 2 strAddress : \(String(describing: strAddress))");
        
        if (strLocalName != nil) {
            //strAddress  = String(format:"%s %s", strAddress, strLocalName!);
            strAddress  = strAddress + " " + strLocalName!;
            if (strName == nil)
            {
                //strName     = String(format:"%s", strLocalName!);
                strName     = strLocalName!;
            }
        }
        
        print("[parseGlobalAddress] 3 strAddress : \(String(describing: strAddress))");
        
        if (strCountryName != nil) {
            //strAddress  = String(format:"%s %s", strAddress, strCountryName!);
            strAddress  = strAddress + " " + strCountryName!;
            if (strName == nil) {
                //strName     = String(format:"%s", strCountryName!);
                strName     = strCountryName!;
            }
        }
        
        print("[parseGlobalAddress] 4 strAddress : \(String(describing: strAddress))");
        
        if ( (strName == nil) || (strName == strCountryName) ) {
            print("Fail to find location address");
        }
        
        //[self updateCurCityInfo:nssName address:nssAddress country:nssCountryName];
        
        print("[parseGlobalAddress] curLatitude : \(curLatitude), curLongitude : \(curLongitude)");
        
        if( strCountryName == "KR" ) {
            getAddressFromDaum(latitude: curLatitude, longitude: curLongitude, tryCount: 0);
        } else {
            print("[parseGlobalAddress] Get locations by using name!!! strAddress : \(String(describing: strAddress))");
            getGeocodeFromGoogle(strAddress: strAddress);
        }
    }
    
    func getGeocodeFromGoogle(strAddress:String)
    {
        //https://maps.googleapis.com/maps/api/geocode/json?address=
        
        #if false
            //var set : CharacterSet = CharacterSet.urlHostAllowed();
            let urlSet = CharacterSet.urlFragmentAllowed
                .union(.urlHostAllowed)
                .union(.urlPasswordAllowed)
                .union(.urlQueryAllowed)
                .union(.urlUserAllowed)
            
            let urlAllowed = CharacterSet.urlFragmentAllowed
                .union(.urlHostAllowed)
                .union(.urlPasswordAllowed)
                .union(.urlQueryAllowed)
                .union(.urlUserAllowed)
        #endif
        
        //var strEncAddress : String = strAddress.stringpe [nssAddress stringByAddingPercentEncodingWithAllowedCharacters:set];
        if let strEncAddress = strAddress.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) {
            print(strEncAddress)  // "http://www.mapquestapi.com/geocoding/v1/batch?key=YOUR_KEY_HERE&callback=renderBatch&location=Pottsville,PA&location=Red%20Lion&location=19036&location=1090%20N%20Charlotte%20St,%20Lancaster,%20PA"
            
            //let strURL : String = String(format:"%s%s", watchTWReq.STR_GOOGLE_ADDR2COORD_URL, strEncAddress);
            let strURL : String = watchTWReq.STR_GOOGLE_ADDR2COORD_URL + strEncAddress;
            print("[getGeocodeFromGoogle] Address : \(strAddress)" );
            print("[getGeocodeFromGoogle] EncAddress : \(strEncAddress)" );
            print("[getGeocodeFromGoogle] url : \(strURL)" );
            
            requestAsyncByURLSession(url:strURL, reqType:InterfaceController.TYPE_REQUEST.GEO_GOOGLE);
        }
    }
    
    func getAddressFromDaum(latitude : Double, longitude : Double, tryCount : Int) {
        //35.281741, 127.292345 <- 곡성군 에러
        // FIXME - for emulator - delete me
        //latitude = 35.281741;
        //longitude = 127.292345;
        var strDaumKey : String? = nil;
        var nextTryCount : Int = 0;
        
        #if false
            if(tryCount == 0) {
                let nsmaDaumKeys : NSMutableArray? = watchTWUtil.getDaumServiceKeys();
                //if let nsmaDaumKeys : NSMutableArray = watchTWUtil.getDaumServiceKeys() {
                let strFirstKey : String = nsmaDaumKeys!.object(at: 0) as! String
                
                if( (nsmaDaumKeys?.count == 0) || (strFirstKey == "0") ) {         // 0, 1(Default)로 들어올때 처리
                    print("[getAddressFromDaum] Keys of NSDefault is empty!!!");
                    strDaumKey = String(format:"%s", watchTWReq.DAUM_SERVICE_KEY);
                } else {
                    //shuffledDaumKeys = [[NSMutableArray alloc] init];
                    shuffledDaumKeys = watchTWUtil.shuffleDatas(nsaDatas: nsmaDaumKeys!);
                    strDaumKey = String(format:"%s", shuffledDaumKeys[tryCount] as! CVarArg);
                    print("[getAddressFromDaum] shuffled first nssDaumKey : \(String(describing: strDaumKey))");
                }
                //            } else {
                //                print("222");
                //            }
                
            }
            else
            {
                if(tryCount >= shuffledDaumKeys.count)
                {
                    print("We are used all keys. you have to ask more keys!!!");
                    return;
                }
                
                strDaumKey = String(format:"%s", shuffledDaumKeys[tryCount] as! CVarArg);
                print("[getAddressFromDaum] tryCount:\(tryCount) shuffled next nssDaumKey : \(String(describing: strDaumKey))");
            }
        #endif
        
        strDaumKey = watchTWReq.DAUM_SERVICE_KEY;
        nextTryCount = tryCount + 1;
        
        //        let strURL : String = String(format:"%s%s%s%s%f%s%f%s%s", watchTWReq.STR_DAUM_COORD2ADDR_URL, watchTWReq.STR_APIKEY, strDaumKey!, watchTWReq.STR_LONGITUDE, longitude, watchTWReq.STR_LATITUDE, latitude, watchTWReq.STR_INPUT_COORD, watchTWReq.STR_OUTPUT_JSON);
        let strURL : String = watchTWReq.STR_DAUM_COORD2ADDR_URL + watchTWReq.STR_APIKEY + strDaumKey! + watchTWReq.STR_LONGITUDE + String(format:"%f",longitude) + watchTWReq.STR_LATITUDE + String(format:"%f",latitude) + watchTWReq.STR_INPUT_COORD + watchTWReq.STR_OUTPUT_JSON;
        
        print("url : \(strURL)");
        
        let dictRetryData : NSDictionary = [ Float(latitude): "latitude",
                                             Float(longitude) : "longitude",
                                             Int(nextTryCount) :  "tryCount" ];
        
        requestAsyncByURLSessionForRetry(url:strURL, reqType:InterfaceController.TYPE_REQUEST.ADDR_DAUM, nsdData: dictRetryData);
    }
    
    func getChangedColorAirStateForComp( strAirState : String) -> NSMutableAttributedString {
        var String : NSMutableAttributedString = NSMutableAttributedString(string:strAirState);
        var sRange : NSRange? = nil;
        
        var stateColor : UIColor? = nil;
        var font = UIFont.boldSystemFont(ofSize : 11.0);
        let nssAirState = strAirState as NSString;
        
        let strGood         = NSLocalizedString("LOC_GOOD", comment:"좋음");
        let strModerate     = NSLocalizedString("LOC_MODERATE", comment:"보통");
        let strSensitive    = NSLocalizedString("LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS", comment:"민감군주의");
        let strUnhealthy    = NSLocalizedString("LOC_UNHEALTHY", comment:"나쁨");
        let strVeryUnhealty = NSLocalizedString("LOC_VERY_UNHEALTHY", comment:"매우나쁨");
        let strHaz          = NSLocalizedString("LOC_HAZARDOUS", comment:"위험");
        
        #if false
            if(watch.is42 == true) {
                print("watch size is 42mm!!! ");
                font = UIFont.boldSystemFont(ofSize : 13.0);
            } else {
                print("watch size is 32mm!!! ");
            }
        #endif
        
        if(strAirState.hasSuffix(strGood))
        {
            sRange = nssAirState.range(of:strGood);
            //NSMakeRange(firstBraceIndex.startIndex, firstClosingBraceIndex.endIndex)
            stateColor = UIColor.init(argb:0xff32a1ff);
        }
        else if(strAirState.hasSuffix(strModerate))
        {
            sRange = nssAirState.range(of:strModerate);     //원하는 텍스트라는 글자의 위치가져오기
            stateColor = UIColor.init(argb:0xff7acf16);
        }
        else if(strAirState.hasSuffix(strSensitive))
        {
            sRange = nssAirState.range(of:strSensitive);      //원하는 텍스트라는 글자의 위치가져오기
            stateColor = UIColor.init(argb:0xfffd934c);                // 나쁨과 동일
        }
        else if(strAirState.hasSuffix(strVeryUnhealty))
        {
            sRange = nssAirState.range(of:strVeryUnhealty);     //원하는 텍스트라는 글자의 위치가져오기
            stateColor = UIColor.init(argb:0xffff7070);
        }
        else if(strAirState.hasSuffix(strUnhealthy))
        {
            sRange = nssAirState.range(of:strUnhealthy);     //원하는 텍스트라는 글자의 위치가져오기
            stateColor = UIColor.init(argb:0xfffd934c);
        }
        else if(strAirState.hasSuffix(strHaz))
        {
            sRange = nssAirState.range(of:strHaz);     //원하는 텍스트라는 글자의 위치가져오기
            stateColor = UIColor.init(argb:0xffff7070);           // 매우나쁨과 동일
        }
        else
        {
            //sRange = Foundation.NSNotFound;
            stateColor = UIColor.black;
            
            return String;
        }
        
        // chagnge "●"
        String = NSMutableAttributedString(string:"●");
        sRange = NSMakeRange(0, 0);
        colorAirState = stateColor!;
        
        String.addAttribute(NSAttributedStringKey.foregroundColor, value:stateColor!, range:sRange!); //attString의 Range위치에 있는 "Nice"의 글자의
        
        String.addAttribute(NSAttributedStringKey.font, value:font, range:sRange!); //attString의 Range위치에 있는 "Nice"의 글자의
        
        return String;
        
    }
    
    func getAirStateForComp( _ currentArpltnDict : Dictionary<String, Any> ) -> String {
        let khaiGrade : Int32   = (currentArpltnDict["khaiGrade"] as AnyObject).int32Value    // 통합대기
        let pm10Grade : Int32   = (currentArpltnDict["pm10Grade"] as AnyObject).int32Value    // 미세먼지
        let pm25Grade : Int32   = (currentArpltnDict["pm25Grade"] as AnyObject).int32Value    // 초미세먼지
        
        let khaiValue : Int32   = (currentArpltnDict["khaiValue"] as AnyObject).int32Value    // 통합대기
        let pm10Value : Int32   = (currentArpltnDict["pm10Value"] as AnyObject).int32Value    // 미세먼지
        let pm25Value : Int32   = (currentArpltnDict["pm25Value"] as AnyObject).int32Value    // 초미세먼지
        
        let strKhaiStr : String = currentArpltnDict["khaiStr"] as! String     // 통합대기
        //let strPm10Str : String = currentArpltnDict["pm10Str"] as! String     // 통합대기
        //let strPm25Str : String = currentArpltnDict["pm25Str"] as! String     // 통합대기
        
        var strResults : String;
        
        print("All air state is same!!! khaiGrade : \(khaiGrade), pm10Grade : \(pm10Grade), pm25Grade : \(pm25Grade)");
        
        
        // Grade가 동일하면 통합대기 값을 전달, 동일할때 우선순위 통합대기 > 미세먼지 > 초미세먼지
        if( (khaiGrade == pm10Grade) && (pm10Grade == pm25Grade) )
        {
            if( (khaiGrade == 0) && (pm10Grade == 0) && (pm25Grade == 0) )
            {
                print("All air state is zero !!!");
            }
            else
            {
                strResults = "\(khaiValue)";
                return strResults;
            }
        }
        else
        {
            if( (khaiGrade > pm10Grade) && (khaiGrade > pm25Grade) )
            {
                strResults = "\(khaiValue)";
                return strResults;
            }
            else if ( (khaiGrade == pm10Grade) && (khaiGrade > pm25Grade) )
            {
                strResults = "\(khaiValue)";
                return strResults;
            }
            else if ( (khaiGrade < pm10Grade) && (khaiGrade > pm25Grade) )
            {
                strResults = "\(pm10Value)㎍";
                return strResults;
            }
            else if ( (khaiGrade > pm10Grade) && (khaiGrade == pm25Grade) )
            {
                strResults = "\(khaiValue)";
                return strResults;
            }
            else if ( (khaiGrade < pm10Grade) && (khaiGrade == pm25Grade) )
            {
                strResults = "\(pm10Value)㎍";
                return strResults;
            }
            else if ( (khaiGrade > pm10Grade) && (khaiGrade < pm25Grade) )
            {
                strResults = "\(pm25Value)㎍";
                return strResults;
            }
            else if ( (khaiGrade == pm10Grade) && (khaiGrade < pm25Grade) )
            {
                strResults = "\(pm25Value)㎍";
                return strResults;
            }
            else if ( (khaiGrade < pm10Grade) && (khaiGrade < pm25Grade) )
            {
                if ( pm10Grade > pm25Grade)
                {
                    strResults = "\(pm10Value)㎍";
                    return strResults;
                }
                else if ( pm10Grade == pm25Grade)
                {
                    strResults = "\(pm10Value)㎍";
                    return strResults;
                }
                else if ( pm10Grade < pm25Grade)
                {
                    strResults = "\(pm25Value)㎍";
                    return strResults;
                }
            }
        }
        
        if( (strKhaiStr == "") || (strKhaiStr == "(null)") ) {
            strResults = "";
        } else {
            strResults = "\(khaiValue)";
        }
        
        return strResults;
    }
    
    func processWeatherResultsWithCompKR( jsonDict : Dictionary<String, AnyObject>?) {
        var todayDict : Dictionary<String, Any>;
        
        // Date
        var strDateTime : String!;
        //var strTime : String? = nil;
        
        // Image
        //var strCurIcon : String? = nil;
        var strCurImgName : String? = nil;
        
        
        // Address
        var strAddress : String? = nil;
        
        // Pop
        var numberTodPop : NSNumber;
        var todayPop : Int = 0;
        
        // current temperature
        var numberT1h : NSNumber;
        var numberTaMin : NSNumber;
        var numberTaMax : NSNumber;
        
        if(jsonDict == nil)
        {
            print("jsonDict is nil!!!");
            return;
        }
        //print("processWeatherResultsWithShowMore : \(String(describing: jsonDict))");
        
        //setCurJsonDict( dict : jsonDict! ) ;
        
        // Address
        if let strRegionName : String = jsonDict?["regionName"] as? String {
            print("strRegionName is \(strRegionName).")
            strAddress = strRegionName;
        } else {
            print("That strRegionName is not in the jsonDict dictionary.")
        }
        
        if let strCityName : String = jsonDict?["cityName"] as? String {
            print("strCityName is \(strCityName).")
            strAddress = strCityName;
        } else {
            print("That strCityName is not in the jsonDict dictionary.")
        }
        
        if let strTownName : String = jsonDict?["townName"] as? String {
            print("strTownName is \(strTownName).")
            strAddress = strTownName;
        } else {
            print("That strTownName is not in the jsonDict dictionary.")
        }
        
        // if address is current position... add this emoji
        //목격자
        //유니코드: U+1F441 U+200D U+1F5E8, UTF-8: F0 9F 91 81 E2 80 8D F0 9F 97 A8
        
        print("strAddress \(String(describing: strAddress)))")
        strAddress = NSString(format: "👁‍🗨%@˚", strAddress!) as String
        
        let tempUnit : TEMP_UNIT? = watchTWUtil.getTemperatureUnit();
        //#if KKH
        // Current
        if let currentDict : Dictionary<String, Any> = jsonDict?["current"] as? Dictionary<String, Any>{
            //print("currentDict is \(currentDict).")
            
            if let strCurIcon : String = currentDict["skyIcon"] as? String {
                //strCurImgName = "weatherIcon2-color/\(strCurIcon).png";
                strCurImgName = strCurIcon;
            } else {
                print("That strCurIcon  is not in the jsonDict dictionary.")
            }
            
            if let strTime : String = currentDict["time"] as? String {
                let index = strTime.index(strTime.startIndex, offsetBy: 2)
                //let strHour = strTime.substring(to:index);
                let strHour = strTime[..<index];
                //let strMinute = strTime.substring(from:index);
                let strMinute = strTime[index...];
                strDateTime         = NSLocalizedString("LOC_UPDATE",        comment:"업데이트") + " " + strHour + ":" + strMinute;
                
                print("strTime => \(strTime)")
                print("strHour => \(strHour)")
                print("strMinute => \(strMinute)")
                
            } else {
                print("That strTime  is not in the jsonDict dictionary.")
                strDateTime         = "";
            }
            print("strDateTime => \(strDateTime)")
            
            if let currentArpltnDict : Dictionary<String, Any> = currentDict["arpltn"] as? Dictionary<String, Any> {
                strAirState         = getAirStateForComp(currentArpltnDict);
                
                
                //"LOC_GOOD"                          = "Good";
                //"LOC_MODERATE"                      = "Moderate";
                //"LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS"= "Unhealthy for sensitive groups";
                //"LOC_UNHEALTHY"                     = "Unhealthy";
                //"LOC_VERY_UNHEALTHY"                = "Very unhealthy";
                //"LOC_HAZARDOUS"                     = "Hazardous";
                
                // Test (Good, Moderate, Unhealthy for sensitive groups, Unhealthy, Very unhealthy, Hazardous)
                //strAirState = "AQI 78 Hazardous";
                attrStrAirState       = getChangedColorAirStateForComp(strAirState:strAirState);
                print("[processWeatherResultsWithCompKR] attrStrAirState : \(String(describing: attrStrAirState))");
                print("[processWeatherResultsWithCompKR] strAirState : \(String(describing: strAirState))");
            } else {
                print("That currentArpltnDict  is not in the jsonDict dictionary.")
            }
            
            if (currentDict["t1h"] != nil)
            {
                numberT1h = currentDict["t1h"] as! NSNumber;
                currentTemp = Float(numberT1h.doubleValue);
                
                if(tempUnit == TEMP_UNIT.FAHRENHEIT) {
                    currentTemp     = Float(watchTWUtil.convertFromCelsToFahr(cels: currentTemp));
                }
                
                print("[processWeatherResultsWithCompKR] currentTemp : \(currentTemp)");
            }
            
        } else {
            print("That currentDict  is not in the jsonDict dictionary.")
        }
        
        //currentHum         = [[currentDict valueForKey:@"reh"] intValue];
        
        todayDict = watchTWUtil.getTodayDictionary(jsonDict: jsonDict!);
        
        // Today
        if (todayDict["taMin"] != nil) {
            numberTaMin = todayDict["taMin"] as! NSNumber;
            todayMinTemp    = Int(numberTaMin.intValue);
        } else {
            print("That idTaMin  is not in the todayDict dictionary.")
        }
        
        if(tempUnit ==  TEMP_UNIT.FAHRENHEIT)
        {
            todayMinTemp     = Int( watchTWUtil.convertFromCelsToFahr(cels: Float(todayMinTemp) ) );
        }
        
        if (todayDict["taMax"] != nil) {
            numberTaMax = todayDict["taMax"] as! NSNumber;
            todayMaxTemp    = Int(numberTaMax.intValue);
        } else {
            print("That numberTaMax  is not in the todayDict dictionary.")
        }
        
        if(tempUnit == TEMP_UNIT.FAHRENHEIT)
        {
            todayMaxTemp     = Int(watchTWUtil.convertFromCelsToFahr(cels: Float(todayMaxTemp) )) ;
        }
        
        if (todayDict["pop"] != nil) {
            numberTodPop = todayDict["pop"] as! NSNumber;
            todayPop    = Int(numberTodPop.intValue);
        } else {
            print("That pop  is not in the todayDict dictionary.")
        }
        
        print("todayMinTemp: \(todayMinTemp), todayMaxTemp:\(todayMaxTemp)");
        print("todayPop: \(todayPop)");
        
        #if false
            DispatchQueue.global(qos: .background).async {
                // Background Thread
                
                DispatchQueue.main.async {
                    
                    // Run UI Updates
                    if(strDateTime != nil) {
                        self.updateDateLabel.setText("\(strDateTime!)");
                    }
                    
                    print("=======>  date : \(strDateTime!)");
                    
                    if( (strAddress == nil) || ( strAddress == "(null)" ))
                    {
                        self.addressLabel.setText("");
                    }
                    else
                    {
                        self.addressLabel.setText("\(strAddress!)");
                    }
                    
                    print("=======>  strCurImgName : \(strCurImgName!)");
                    
                    if(strCurImgName != nil) {
                        self.curWeatherImage.setImage ( UIImage(named:strCurImgName!) );
                    }
                    
                    if(tempUnit == TEMP_UNIT.FAHRENHEIT) {
                        self.curTempLabel.setText( NSString(format: "%d˚", currentTemp) as String );
                    } else {
                        self.curTempLabel.setText( NSString(format: "%.01f˚", currentTemp) as String);
                    }
                    
                    
                    print("[processWeatherResultsWithCompKR] attrStrAirState2 : \(String(describing: attrStrAirState))");
                    self.airAQILabel.setAttributedText( attrStrAirState );
                    
                    self.minMaxLabel.setText(NSString(format: "%d˚/ %d˚", todayMinTemp, todayMaxTemp) as String );
                    self.precLabel.setText(NSString(format: "%d%%", todayPop) as String );
                }
            }
        #endif
    }
    
    
    func processWeatherResultsAboutCompGlobal( jsonDict : Dictionary<String, AnyObject>?) {
        var currentDict : Dictionary<String, Any>;
        //var currentArpltnDict : Dictionary<String, Any>;
        var todayDict : Dictionary<String, Any>? = nil;
        
        // Date
        var strDateTime : String!;
        //var strTime : String? = nil;
        
        // Temperature
        var tempUnit : TEMP_UNIT? = TEMP_UNIT.CELSIUS;
        
        // Dust
        
        var attrStrAirState : NSAttributedString = NSAttributedString();
        //NSMutableAttributedString   *nsmasAirState = nil;
        
        // Pop
        var numberTodPop : NSNumber;
        
        // Humid
        var numberTodHumid : NSNumber;
        var todayHumid = 0;
        
        if(jsonDict == nil)
        {
            print("jsonDict is nil!!!");
            return;
        }
        //print("processWeatherResultsWithShowMore : \(String(describing: jsonDict))");
        
        //setCurJsonDict( dict : jsonDict! ) ;
        
        // Address
        
        //NSLog(@"mCurrentCityIdx : %d", mCurrentCityIdx);
        
        //NSMutableDictionary* nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
        //NSLog(@"[processWeatherResultsAboutGlobal] nsdCurCity : %@", nsdCurCity);
        // Address
        //nssAddress = [nsdCurCity objectForKey:@"name"];
        //nssCountry = [nsdCurCity objectForKey:@"country"];
        //if(nssCountry == nil)
        //{
        //  nssCountry = @"KR";
        //}
        
        //NSLog(@"[Global]nssAddress : %@, nssCountry : %@", nssAddress, nssCountry);
        
        // if address is current position... add this emoji
        //목격자
        //유니코드: U+1F441 U+200D U+1F5E8, UTF-8: F0 9F 91 81 E2 80 8D F0 9F 97 A8
        
        //print("strAddress \(String(describing: strAddress)))")
        //strAddress = NSString(format: "👁‍🗨%@˚", strAddress!) as String
        
        strAddress = NSString(format: "뉴욕") as String;
        // Current
        if let thisTimeArr : NSArray = jsonDict?["thisTime"] as? NSArray {
            
            if(thisTimeArr.count == 2) {
                currentDict         = thisTimeArr[1] as! Dictionary<String, Any>;        // Use second index; That is current weahter.
            } else {
                currentDict         = thisTimeArr[0] as! Dictionary<String, Any>;        // process about thisTime
            }
            print("bbbb")
            if let strCurIcon : String = currentDict["skyIcon"] as? String {
                //strCurImgName = "weatherIcon2-color/\(strCurIcon).png";
                print("ccccc")
                strCurImgName = strCurIcon;
                print("strCurImgName : \(strCurImgName)")
            } else {
                print("That strCurIcon  is not in the jsonDict dictionary.")
            }
            print("ddddd")
            tempUnit = watchTWUtil.getTemperatureUnit();
            
            if let strTime : String = currentDict["date"] as? String {
                let index = strTime.index(strTime.startIndex, offsetBy: 11)
                let strHourMin = strTime[index...];
                strDateTime         = NSLocalizedString("LOC_UPDATE",        comment:"업데이트") + " " + strHourMin;
                print("strTime => \(strHourMin)")
                
                todayDict = watchTWUtil.getTodayDictionaryInGlobal(jsonDict: jsonDict!, strTime:strTime);
                if(todayDict != nil) {
                    if(tempUnit == TEMP_UNIT.FAHRENHEIT)
                    {
                        let idTaMin    = todayDict!["tempMin_f"] as! NSNumber;
                        todayMinTemp    = Int(truncating: idTaMin);
                        
                        let idTaMax    = todayDict!["tempMax_f"] as! NSNumber;
                        todayMaxTemp    = Int(truncating: idTaMax);
                    }
                    else
                    {
                        let idTaMin    = todayDict!["tempMin_c"] as! NSNumber;
                        todayMinTemp    = Int(truncating: idTaMin);
                        
                        let idTaMax    = todayDict!["tempMax_c"] as! NSNumber;
                        todayMaxTemp    = Int(truncating: idTaMax);
                    }
                    
                    // PROBABILITY_OF_PRECIPITATION
                    if (todayDict!["precProb"] != nil) {
                        numberTodPop = todayDict!["precProb"] as! NSNumber;
                        todayPop    = Int(numberTodPop.intValue);
                    } else {
                        print("That precProb  is not in the todayDict dictionary.")
                    }
                    
                    // HUMID
                    if (todayDict!["humid"] != nil) {
                        numberTodHumid = todayDict!["humid"] as! NSNumber;
                        todayHumid    = Int(numberTodHumid.intValue);
                    } else {
                        print("That humid  is not in the todayDict dictionary.")
                    }
                    
                    strAirState = NSLocalizedString("LOC_HUMIDITY", comment:"습도") + " \(todayHumid)% ";
                }
            } else {
                print("That strTime  is not in the jsonDict dictionary.")
                let strHourMin         = "";
                strDateTime         = NSLocalizedString("LOC_UPDATE",        comment:"업데이트") + " " + strHourMin;
            }
            print("strDateTime => \(strDateTime)")
            
            if(tempUnit == TEMP_UNIT.FAHRENHEIT)
            {
                let idT1h    = currentDict["temp_f"] as! NSNumber;
                currentTemp     = Float(Int(truncating: idT1h));
            }
            else
            {
                let idT1h    = currentDict["temp_c"] as! NSNumber;
                currentTemp     = Float(truncating: idT1h);
            }
        }
        
        print("todayMinTemp: \(todayMinTemp), todayMaxTemp:\(todayMaxTemp)");
        print("todayPop: \(todayPop)");
        print("=======>  strCurImgName : \(strCurImgName)");
        
        if let currentDict : Dictionary<String, Any> = jsonDict?["current"] as? Dictionary<String, Any>{
            //print("currentDict is \(currentDict).")
            
            if let currentArpltnDict : Dictionary<String, Any> = currentDict["arpltn"] as? Dictionary<String, Any> {
                strAirState         = watchTWSM.getAirState(currentArpltnDict);
                
                // Test
                //nssAirState = [NSString stringWithFormat:@"통합대기 78 나쁨"];
                attrStrAirState       = watchTWSM.getChangedColorAirState(strAirState:strAirState);
                print("[processWeatherResultsAboutCompGlobal] attrStrAirState : \(String(describing: attrStrAirState))");
                print("[processWeatherResultsAboutCompGlobal] strAirState : \(String(describing: strAirState))");
            } else {
                print("That currentArpltnDict  is not in the jsonDict dictionary.")
            }
        } else {
            print("That currentDict  is not in the jsonDict dictionary.")
        }
        
        #if KKH
            if let currentDict : Dictionary<String, Any> = jsonDict?["current"] as? Dictionary<String, Any>{
                //print("currentDict is \(currentDict).")
                
                if let currentArpltnDict : Dictionary<String, Any> = currentDict["arpltn"] as? Dictionary<String, Any> {
                    strAirState         = watchTWSM.getAirState(currentArpltnDict);
                    
                    // Test
                    //nssAirState = [NSString stringWithFormat:@"통합대기 78 나쁨"];
                    attrStrAirState       = watchTWSM.getChangedColorAirState(strAirState:strAirState);
                    print("[processWeatherResultsWithShowMore] attrStrAirState : \(String(describing: attrStrAirState))");
                    print("[processWeatherResultsWithShowMore] strAirState : \(String(describing: strAirState))");
                } else {
                    print("That currentArpltnDict  is not in the jsonDict dictionary.")
                }
            } else {
                print("That currentDict  is not in the jsonDict dictionary.")
            }
            
            
            if(strDateTime != nil) {
                self.updateDateLabel.setText("\(strDateTime!)");
            }
            
            print("=======>  date : \(strDateTime!)");
            
            if( (strAddress == nil) || ( strAddress == "(null)" ))
            {
                self.addressLabel.setText("");
            }
            else
            {
                self.addressLabel.setText("\(strAddress!)");
            }
            
            print("=======>  strCurImgName : \(strCurImgName!)");
            strCurImgName = "MoonBigCloudRainLightning";
            if(strCurImgName != nil) {
                self.curWeatherImage.setImage ( UIImage(named:"Moon"/*strCurImgName!*/) );
                print("111=======>  strCurImgName : \(strCurImgName!)");
            }
            
            if(tempUnit == TEMP_UNIT.FAHRENHEIT) {
                self.curTempLabel.setText( NSString(format: "%d˚", currentTemp) as String );
            } else {
                self.curTempLabel.setText( NSString(format: "%.01f˚", currentTemp) as String);
            }
            
            
            #if KKH
                print("[processWeatherResultsWithShowMore] attrStrAirState2 : \(String(describing: attrStrAirState))");
                self.airAQILabel.setAttributedText( attrStrAirState );
            #endif
            
            self.minMaxLabel.setText(NSString(format: "%d˚/ %d˚", todayMinTemp, todayMaxTemp) as String );
            self.precLabel.setText(NSString(format: "%d%%", todayPop) as String );
            self.airAQILabel.setText(strAirState);
            
        #endif
        
    }
    
    func refreshComplications() {
        let server : CLKComplicationServer = CLKComplicationServer.sharedInstance();
        print("refreshComplications");
        for(complication) in server.activeComplications! {
            print("\(complication)");
            server.reloadTimeline(for: complication)
        }
    }
    
    //internal func  getNextRequestedUpdateDate ( handler :  @ escaping  ( Date?)  ->  Void )  {
    //    handler ( Date ( timeIntervalSinceNow :  TimeInterval ( 10 * 60 )))
    //}
    
    // MARK: - Placeholder Templates
    
    func getLocalizableSampleTemplate(for complication: CLKComplication, withHandler handler: @escaping (CLKComplicationTemplate?) -> Void) {
        // This method will be called once per supported complication, and the results will be cached
        if  complication . family ==  . utilitarianSmall  {
            let  template  =  CLKComplicationTemplateUtilitarianSmallRingText ()
            template . textProvider  =  CLKSimpleTextProvider ( text :  "3" )
            template . fillFraction  =  self.dayFraction
            handler ( template )
        }  else  {
            handler ( nil )
        }
    }
    
    var  dayFraction  :  Float  {
        let retVal : Float
        let  now  = Date ()
        let  calendar  =  Calendar.current
        //let  componentFlags  =  Set<Calendar.Component > ([.year, .month , .day , .WEEKOFYEAR, .hour, .minute ,.second ,.weekday, .weekdayOrdinal])
        let componentFlags = Set<Calendar.Component>([.year, .month, .day, .weekOfYear, .hour, .minute, .second, .weekday, .weekdayOrdinal])
        var  components  =  calendar . dateComponents (componentFlags ,  from :  now )
        components . hour  =  0
        components . minute  =  0
        components . second  =  0
        let  startOfDay  =  calendar . date ( from :  components )
        
        retVal = Float( now . timeIntervalSince ( startOfDay! ))  /  Float( 24 * 60 * 60 )
        return retVal
    }
    
    #if KKH
    func getSupportedTimeTravelDirectionsForComplication(complication: CLKComplication, withHandler handler: (CLKComplicationTimeTravelDirections) -> Void) {
    //handler([CLKComplicationTimeTravelDirections.None])
    handler([])
    }
    
    func getTimelineEntriesForComplication(complication: CLKComplication, beforeDate date: NSDate, limit: Int, withHandler handler: ([CLKComplicationTimelineEntry]?) -> Void) {
    handler(nil)
    }
    
    func getTimelineEntriesForComplication(complication: CLKComplication, afterDate date: NSDate, limit: Int, withHandler handler: ([CLKComplicationTimelineEntry]?) -> Void) {
    handler([])
    }
    
    func getTimelineStartDateForComplication(complication: CLKComplication, withHandler handler: (NSDate?) -> Void) {
    handler(NSDate())
    }
    
    func getTimelineEndDateForComplication(complication: CLKComplication, withHandler handler: (NSDate?) -> Void) {
    handler(NSDate())
    }
    
    func getPrivacyBehaviorForComplication(complication: CLKComplication, withHandler handler: (CLKComplicationPrivacyBehavior) -> Void) {
    handler(CLKComplicationPrivacyBehavior.showOnLockScreen)
    }
    
    #endif
}


