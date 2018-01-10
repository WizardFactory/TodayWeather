//
//  WatchTWeatherUtil.swift
//  TodayWeather
//
//  Created by KwangHo Kim on 2017. 7. 23..
//
//

import Foundation

enum TEMP_UNIT {
    case NONE
    case CELSIUS
    case FAHRENHEIT
    case MAX
}

class WatchTWeatherUtil {
    
    var gTemperatureUnit : TEMP_UNIT? = nil;
    var gArrDaumKeys = [String]();
    
    #if false
    static let sharedInstance : WatchTWeatherUtil = {
    let instance = WatchTWeatherUtil()
    //setup code
    return instance
    }()
    #endif
    struct StaticInstance {
        static var instance: WatchTWeatherUtil?
    }
    
    class func sharedInstance() -> WatchTWeatherUtil {
        if !(StaticInstance.instance != nil) {
            StaticInstance.instance = WatchTWeatherUtil()
        }
        return StaticInstance.instance!
    }
    
    //    let watchTWReq = WatchTWeatherRequest.sharedInstance();
    //    let watchTWSM = WatchTWeatherShowMore.sharedInstance();
    //    let watchTWDraw = WatchTWeatherDraw.sharedInstance();
    
    /********************************************************************
     *
     * Name            : getTemperatureUnit
     * Description    : get temperature unit by country
     * Returns        : TEMP_UNIT
     * Side effects :
     * Date            : 2017. 3. 19
     * Author        : SeanKim
     * History        : 20170219 SeanKim Create function
     *
     ********************************************************************/
    func getTemperatureUnit() -> TEMP_UNIT? {
        print("gTemperatureUnit : \(String(describing: gTemperatureUnit))" );
        return gTemperatureUnit;
    }
    
    /********************************************************************
     *
     * Name            : setTemperatureUnit
     * Description    : set temperature unit by NSDefaults
     * Returns        : TEMP_UNIT
     * Side effects :
     * Date            : 2017. 3. 27
     * Author        : SeanKim
     * History        : 20170327 SeanKim Create function
     *
     ********************************************************************/
    func setTemperatureUnit( strUnits : String? )
    {
        if(strUnits == nil) {
            print("strUnits is null!!!");
            return;
        }
        
        let tmpUnitData = strUnits?.data(using: String.Encoding.utf8);// dataUsingEncoding:NSUTF8StringEncoding];
        do {
            let jsonObject = try JSONSerialization.jsonObject(with: tmpUnitData!, options:JSONSerialization.ReadingOptions(rawValue: 0))
            guard let dictionary = jsonObject as? Dictionary<String, Any> else {
                print("Not a Dictionary")
                // put in functionåå√
                return
            }
            
            let strTempUnit : String = dictionary["temperatureUnit"] as! String;
            if(strTempUnit == "F") {
                gTemperatureUnit = TEMP_UNIT.FAHRENHEIT;
            } else {
                gTemperatureUnit = TEMP_UNIT.CELSIUS;
            }
            
            print("JSON Dictionary! \(dictionary)")
        }
        catch let error as NSError {
            print("Found an error - \(error)")
        }
        
        //FIXME
        //gTemperatureUnit = TEMP_UNIT_FAHRENHEIT;
        
        return;
    }
    
    func convertFromCelsToFahr ( cels : Float ) -> Float {
        let fahr : Float = cels * 1.8 + 32;
        
        return fahr;
    }
    
    
    /********************************************************************
     *
     * Name            : getTodayDictionaryInGlobal
     * Description    : get today dictionary in global
     * Returns        : Dictionary
     * Side effects :
     * Date            : 2017. 10. 13
     * Author        : SeanKim
     * History        : 20171013 SeanKim Create function
     *
     ********************************************************************/
    func getTodayDictionaryInGlobal(jsonDict : Dictionary<String, Any>, strTime : String ) -> Dictionary<String, Any>? {
        //var strCurrentDate : String? = nil;
        var dailyDataArr : NSArray? = nil;
        var todayDict : Dictionary<String, Any>? = nil;
        
        let index = strTime.index(strTime.startIndex, offsetBy: 10)
        let strCurrentDate = strTime[..<index];
        
        dailyDataArr        = jsonDict["daily"] as? NSArray;
        
        for dict in dailyDataArr! {
            //var dailyDataDict : Dictionary = dailyDataArr?.object(at: i as! Int) as! Dictionary<String, Any>;
            var dailyDataDict : Dictionary = dict as! Dictionary<String, Any>;
            let strDailyDateTemp : String = dailyDataDict["date"]! as! String;
            let strDailyDate = strDailyDateTemp[..<index];
            
            //print("1 strCurrentDate : \(String(describing: strCurrentDate)), strDailyDate : \(String(describing: strDailyDate))");
            
            if(strCurrentDate == strDailyDate)
            {
                print("2 strCurrentDate : \(String(describing: strCurrentDate)), strDailyDate : \(String(describing: strDailyDate))");
                todayDict = dailyDataDict;
                
                break;
            }
        }
        
        print("todayDict: \(String(describing: todayDict))");
        
        return todayDict;
    }
    
    /********************************************************************
     *
     * Name            : getTodayDictionary
     * Description    : get today dictionary
     * Returns        : Dictionary
     * Side effects :
     * Date            : 2017. 9. 29
     * Author        : SeanKim
     * History        : 20170929 SeanKim Create function
     *
     ********************************************************************/
    func getTodayDictionary(jsonDict : Dictionary<String, Any> ) -> Dictionary<String, Any> {
        var strCurrentDate : String? = nil;
        var dailyDataArr : NSArray? = nil;
        var todayDict : Dictionary<String, Any>? = nil;
        
        if let currentDict : Dictionary<String, Any> = jsonDict["current"] as? Dictionary<String, Any> {
            strCurrentDate        = currentDict["date"] as? String;
            //print("currentDict : \(String(describing: currentDict))");
            print("getTodayArray strCurrentDate : \(String(describing: strCurrentDate))");
        } else {
            print("That currentDict  is not in the jsonDict dictionary.")
        }
        
        if let midDict : Dictionary<String, Any> = jsonDict["midData"] as? Dictionary<String, Any> {
            dailyDataArr        = midDict["dailyData"] as? NSArray;
            
            //print("midDict : \(String(describing: midDict))");
            print("province : \(String(describing: midDict["province"]))");
            //print("dailyDataArr : \(String(describing: midDict["dailyData"]))");
            //print("dailyDataArr : \(String(describing: dailyDataArr))");
            for dict in dailyDataArr! {
                //var dailyDataDict : Dictionary = dailyDataArr?.object(at: i as! Int) as! Dictionary<String, Any>;
                var dailyDataDict : Dictionary = dict as! Dictionary<String, Any>;
                let strDailyDate : String = dailyDataDict["date"]! as! String;
                if(strCurrentDate == strDailyDate)
                {
                    print("strCurrentDate : \(String(describing: strCurrentDate)), strDailyDate : \(String(describing: strDailyDate))");
                    todayDict = dailyDataDict;
                    
                    break;
                }
            }
            
        } else {
            print("That midDict  is not in the jsonDict dictionary.")
        }
        
        
        print("todayDict: \(String(describing: todayDict))");
        
        return todayDict!;
    }
    
    /********************************************************************
     *
     * Name            : processLocationStr
     * Description    : processed locations 2 decimal places.
     * Returns        : NSString *
     * Side effects :
     * Date            : 2017. 10. 7
     * Author        : SeanKim
     * History        : 20171007 SeanKim Create function
     *
     ********************************************************************/
    func processLocationStr(strSrcStr : String? ) -> String? {
        var strDstStr : String? = nil;
        
        if(strSrcStr == nil) {
            print("[processLocationStr] nssSrcStr is nil!!!");
            return nil;
        }
        
        //print("[processLocationStr] \(nssSrcStr)");
        
        var arrSrc : Array?     = strSrcStr?.components(separatedBy: ".");
        let strFirst : String? = arrSrc?[0];
        let strTmp : String = arrSrc![1];
        
        //let strSecond = strTmp.substring(to:strTmp.index(strTmp.startIndex, offsetBy:2));
        let index = strTmp.index(strTmp.startIndex, offsetBy: 2);
        let strSecond = strTmp[..<index];
        
        //strDstStr   = NSString(format: "%s.%s", strFirst!, strSecond as CVarArg) as String;
        //strDstStr   = String(format: "%s.%s", strFirst!, strSecond as CVarArg) as String;
        strDstStr   = strFirst! + "." + strSecond;
        
        //print("[processLocationStr] \(strDstStr)");
        
        return strDstStr;
    }
    
    func makeGlobalRequestURL(locDict : NSDictionary) -> String? {
        let strURL : String? = "http://";
        print("[makeGlobalRequestURL] this is WatchTWeatherUtil!!!!");
        
        return strURL;
    }
    
    func getDaumServiceKeys() -> NSMutableArray {
        
        if(gArrDaumKeys.count == 0) {
            
            print("gArrDaumKeys.count is 0");
            //strDaumKey = String(format:"%s", watchTWReq.DAUM_SERVICE_KEY);
            let strDefaultDaumKey : String = watchTWReq.DAUM_SERVICE_KEY;
            setDaumServiceKeys(strDaumKeys: strDefaultDaumKey);
        }
        
        return gArrDaumKeys as! NSMutableArray;
    }
    
    #if false
    func replace(searchString:String, pattern : String, replacementPattern:String)->String?{
    var error:NSError? = nil;
    let regex = NSRegularExpression .regularExpressionWithPattern(pattern, options: NSRegularExpression.Options.DotMatchesLineSeparators, error: &error)
    if (!error){
    let replacedString = regex.stringByReplacingMatchesInString(searchString, options: NSMatchingOptions.fromMask(0), range: NSMakeRange(0, countElements(searchString)), withTemplate: replacementPattern)
    return replacedString
    }
    return nil
    }
    #endif
    
    /********************************************************************
     *
     * Name            : setDaumServiceKeys
     * Description    : set Daum Service Keys by NSDefaults
     * Returns        : void
     * Side effects :
     * Date            : 2017. 5. 27
     * Author        : SeanKim
     * History        : 20170527 SeanKim Create function
     *
     ********************************************************************/
    func setDaumServiceKeys(strDaumKeys : String?) {
        var tmpData : Data? = nil;
        var arrDaumKeys : NSMutableArray?;
        //var error:NSError? = nil;
        
        if(strDaumKeys == nil) {
            print("strDaumKeys is null!!!");
            return;
        }
        
        print("nsmaDaumKeys : \(String(describing: strDaumKeys))" );
        tmpData = strDaumKeys?.data(using: String.Encoding.utf8);
        print("tmpData : \(String(describing: tmpData))" )
        
        #if false
            //        var regex : NSRegularExpression = NSRegularExpression.regul regularExpressionWithPattern:@"\\s+<!--.*$"
            //            options:NSRegularExpressionDotMatchesLineSeparators
            //            error:nil];
            let pattern = "\\s+<!--.*$"
            let regex = NSRegularExpression.regularExpressionWithPattern(pattern, options: NSRegularExpression.Options.DotMatchesLineSeparators, error:nil)
        #endif
        
        if (tmpData != nil) {
            do {
                let arrDaumKeys = try JSONSerialization.jsonObject(with: tmpData!, options: JSONSerialization.ReadingOptions.allowFragments) as! [String]
                
                //if let arrDaumKeys = try JSONSerialization.jsonObject(with: tmpData!, options: JSONSerialization.ReadingOptions.allowFragments) as! [String] {
                // parse JSON
                print("arrDaumKeys : \(String(describing: arrDaumKeys))" )
                gArrDaumKeys.append(contentsOf: arrDaumKeys)
                //gArrDaumKeys = arrDaumKeys;
                //}
            } catch {
                print(error)
            }
            
            //NSArray  *nsaDaumKeys = [[NSArray alloc] initWithObjects:@"0", @"1", @"2", @"3", nil];
            
            #if KKH
                for i in 0 ..< arrDaumKeys.count {
                    print("original \(i) : \(arrDaumKeys[i])");
                }
            #endif
            
            //nsmaDaumKeys = arrDaumKeys;
            
            #if KKH
                // Use this code in requesting url to daum
                var nsmaShufflKeys : NSMutableArray = shuffleDatas(gArrDaumKeys);
                
                for i in 0 ..< nsmaShufflKeys.count {
                    print("shuffled \(i) : \(nsmaShufflKeys[i])" );
                }
            #endif
        }
        
        return;
    }
    
    
    func exchange<T>( data: inout [T], i: Int, j: Int) {
        data.swapAt(i, j)
    }
    
    func shuffleDatas(nsaDatas : NSMutableArray) -> NSMutableArray
    {
        let count : UInt32 = UInt32(nsaDatas.count);
        for i in 0 ..< (count - 1) {
            // Select a random element between i and end of array to swap with.
            let nElements : UInt32 = count - i;
            
            //var n : Int = Int(arc4random_uniform(UInt32(nElements)) + i);
            let n : UInt32 = arc4random_uniform(nElements) + i;
            //[nsaDatas exchangeObjectAtIndex:i withObjectAtIndex:n];
            //exchange(data: &nsaDatas, i: i, j: n)
            swap(&nsaDatas[Int(i)], &nsaDatas[Int(n)])
        }
        
        return nsaDatas;
    }
}

