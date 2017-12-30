//
//  WatchTWeatherShowMore.swift
//  TodayWeather
//
//  Created by KwangHo Kim on 2017. 7. 18..
//
//

import Foundation
import UIKit
import WatchKit
import WatchConnectivity

extension UIColor {
    
    convenience init(argb: UInt) {
        self.init(
            red: CGFloat((argb & 0xFF0000) >> 16) / 255.0,
            green: CGFloat((argb & 0x00FF00) >> 8) / 255.0,
            blue: CGFloat(argb & 0x0000FF) / 255.0,
            alpha: CGFloat((argb & 0xFF000000) >> 24) / 255.0
        )
    }
}

class WatchTWeatherShowMore {
    
    // Singleton
    #if false
    static let sharedInstance : WatchTWeatherShowMore = {
    let instance = WatchTWeatherShowMore()
    //setup code
    return instance
    }()
    #endif
    struct StaticInstance {
        static var instance: WatchTWeatherShowMore?
    }
    
    class func sharedInstance() -> WatchTWeatherShowMore {
        if !(StaticInstance.instance != nil) {
            StaticInstance.instance = WatchTWeatherShowMore()
        }
        return StaticInstance.instance!
    }
    
    
    //    let watchTWUtil = WatchTWeatherUtil.sharedInstance();
    //    let watchTWReq = WatchTWeatherRequest.sharedInstance();
    //    let watchTWDraw = WatchTWeatherDraw.sharedInstance();
    
    func getAirState( _ currentArpltnDict : Dictionary<String, Any> ) -> String {
        let khaiGrade : Int32   = (currentArpltnDict["khaiGrade"] as AnyObject).int32Value    // 통합대기
        let pm10Grade : Int32   = (currentArpltnDict["pm10Grade"] as AnyObject).int32Value    // 미세먼지
        let pm25Grade : Int32   = (currentArpltnDict["pm25Grade"] as AnyObject).int32Value    // 초미세먼지
        
        let khaiValue : Int32   = (currentArpltnDict["khaiValue"] as AnyObject).int32Value    // 통합대기
        let pm10Value : Int32   = (currentArpltnDict["pm10Value"] as AnyObject).int32Value    // 미세먼지
        let pm25Value : Int32   = (currentArpltnDict["pm25Value"] as AnyObject).int32Value    // 초미세먼지
        
        let strKhaiStr : String = currentArpltnDict["khaiStr"] as! String     // 통합대기
        let strPm10Str : String = currentArpltnDict["pm10Str"] as! String     // 통합대기
        let strPm25Str : String = currentArpltnDict["pm25Str"] as! String     // 통합대기
        
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
                strResults = NSLocalizedString("LOC_AQI", comment:"통합대기") + " \(khaiValue) " + strKhaiStr;
                return strResults;
            }
        }
        else
        {
            if( (khaiGrade > pm10Grade) && (khaiGrade > pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_AQI", comment:"통합대기") + " \(khaiValue) " + strKhaiStr;
                return strResults;
            }
            else if ( (khaiGrade == pm10Grade) && (khaiGrade > pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_AQI", comment:"통합대기") + " \(khaiValue) " + strKhaiStr;
                return strResults;
            }
            else if ( (khaiGrade < pm10Grade) && (khaiGrade > pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_PM10", comment:"미세먼지") + " \(pm10Value) " + strPm10Str;
                return strResults;
            }
            else if ( (khaiGrade > pm10Grade) && (khaiGrade == pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_AQI", comment:"통합대기") + " \(khaiValue) " + strKhaiStr;
                return strResults;
            }
            else if ( (khaiGrade < pm10Grade) && (khaiGrade == pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_PM10", comment:"미세먼지") + " \(pm10Value) " + strPm10Str;
                return strResults;
            }
            else if ( (khaiGrade > pm10Grade) && (khaiGrade < pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_PM25", comment:"초미세먼지") + " \(pm25Value) " + strPm25Str;
                return strResults;
            }
            else if ( (khaiGrade == pm10Grade) && (khaiGrade < pm25Grade) )
            {
                strResults = NSLocalizedString("LOC_PM25", comment:"초미세먼지") + " \(pm25Value) " + strPm25Str;
                return strResults;
            }
            else if ( (khaiGrade < pm10Grade) && (khaiGrade < pm25Grade) )
            {
                if ( pm10Grade > pm25Grade)
                {
                    strResults = NSLocalizedString("LOC_PM10", comment:"미세먼지") + " \(pm10Value) " + strPm10Str;
                    return strResults;
                }
                else if ( pm10Grade == pm25Grade)
                {
                    strResults = NSLocalizedString("LOC_PM10", comment:"미세먼지") + " \(pm10Value) " + strPm10Str;
                    return strResults;
                }
                else if ( pm10Grade < pm25Grade)
                {
                    strResults = NSLocalizedString("LOC_PM25", comment:"초미세먼지") + " \(pm25Value) " + strPm25Str;
                    return strResults;
                }
            }
        }
        
        if( (strKhaiStr == "") || (strKhaiStr == "(null)") ) {
            strResults = "";
        } else {
            strResults = NSLocalizedString("LOC_AQI", comment:"통합대기") + " \(khaiValue) " + strKhaiStr;
        }
        
        return strResults;
    }
    
    func getChangedColorAirState( strAirState : String) -> NSMutableAttributedString {
        let String : NSMutableAttributedString = NSMutableAttributedString(string:strAirState);
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
        
        if(watch.is42 == true) {
            print("watch size is 42mm!!! ");
            font = UIFont.boldSystemFont(ofSize : 13.0);
        } else {
            print("watch size is 32mm!!! ");
        }
        
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
        
        String.addAttribute(NSAttributedStringKey.foregroundColor, value:stateColor!, range:sRange!); //attString의 Range위치에 있는 "Nice"의 글자의
        
        String.addAttribute(NSAttributedStringKey.font, value:font, range:sRange!); //attString의 Range위치에 있는 "Nice"의 글자의
        
        return String;
        
    }
    
    public struct watch {
        
        public static var screenWidth: CGFloat {
            return WKInterfaceDevice.current().screenBounds.width
        }
        
        public static var is38: Bool {
            return screenWidth == 136
        }
        
        public static var is42: Bool {
            return screenWidth == 156
        }
    }
    
    
}


