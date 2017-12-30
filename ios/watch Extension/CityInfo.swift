//
//  CityInfo.swift
//  watch Extension
//
//  Created by KwangHo Kim on 2017. 11. 26..
//

import Foundation

class CityInfo: NSObject , NSCoding
{
    //var identifier : String = "";
    var strAddress : String? = "";
    var currentPosition : Bool? = true;
    var index : Int? = 0;
    var weatherData : Dictionary<String, Any>? = [:];
    var name : String? = "";
    var country : String? = "KR";
    var dictLocation : Dictionary<String, Any>? = [:];
    
    override init(){
        super.init();
    }
    
    func encode(with aCoder: NSCoder) {
        print("encode");
        //aCoder.encode(self.identifier,  forKey: "id");
        aCoder.encode(self.strAddress,    forKey: "address");
        aCoder.encode(self.currentPosition,    forKey: "current_position");
        aCoder.encode(self.index,    forKey: "index");
        aCoder.encode(self.weatherData,    forKey: "weather_data");
        aCoder.encode(self.name,    forKey: "name");
        aCoder.encode(self.country, forKey: "country");
        aCoder.encode(self.dictLocation,   forKey: "location");
    }
    
    required init?(coder aDecoder: NSCoder) {
        print("required init?(coder aDecoder: NSCoder)");
        super.init()
        print("required init?(coder aDecoder: NSCoder)");
        //self.identifier             = aDecoder.decodeObject(forKey: "id") as! String;
        self.strAddress         = aDecoder.decodeObject(forKey: "address") as? String;
        self.currentPosition    = aDecoder.decodeObject(forKey: "current_position") as? Bool;
        self.index              = aDecoder.decodeObject(forKey: "index") as? Int;
        self.weatherData        = aDecoder.decodeObject(forKey: "weather_data") as? Dictionary;
        self.name               = aDecoder.decodeObject(forKey: "name") as? String
        self.country            = aDecoder.decodeObject(forKey: "country") as? String
        self.dictLocation       = aDecoder.decodeObject(forKey: "location") as? Dictionary;
        
    }
    
    init(data : [String: AnyObject]) {
        print("222init(data :");
        super.init()
        print("init(data : [String: AnyObject])");
        //self.identifier         = String.numberValue(data["user_id"]).intValue;
        self.strAddress         = String(format:"%s", (data["address"] as? CVarArg)!);
        self.currentPosition    = Bool((data["current_position"] as? String)!)!;
        self.index              = Int((data["address"] as? String)!)!;
        self.weatherData        = data["address"] as? Dictionary;
        self.name               = data["name"] as? String;
        self.country            = data["country"] as? String;
        self.dictLocation       = data["location"] as? Dictionary;
    }
    
    class func loadCurrentCity()  -> CityInfo {
        print("loadcity 111");
        let defaults = UserDefaults(suiteName: "group.net.wizardfactory.todayweather")
        print("loadcity 222");
        //if let  archivedObject : NSData? = defaults?.object(forKey:"currentCity") as? NSData{
        var archivedObject : NSData? = nil;
        print("loadcity 555");
        archivedObject = defaults?.object(forKey:"currentCity") as? NSData
        print("loadcity 333");
        if(archivedObject == nil)
        {
            print("archivedObject is nil!!!");
        }
        else {
            print("loadcity 666");
            
            //if let cityInfo  = NSKeyedUnarchiver.unarchiveObject(with: archivedObject! as Data) as? CityInfo {
            var cityInfo : CityInfo? = nil;
            print("loadcity 777");
            cityInfo = NSKeyedUnarchiver.unarchiveObject(with: archivedObject! as Data) as? CityInfo
            print("loadcity 888");
            if(cityInfo != nil) {
                print("loadcity 444");
                return cityInfo!;
            } else {
                print("cityInfo is nil");
            }
        }
        //}
        
        return CityInfo()
    }
    
    func saveCityInfo(){
        let defaults = UserDefaults(suiteName: "group.net.wizardfactory.todayweather")
        let archivedObject : NSData = NSKeyedArchiver.archivedData(withRootObject: self) as NSData
        
        defaults?.set(archivedObject, forKey: "currentCity");
        defaults?.synchronize();
    }
    
    func deleteUser(){
        UserDefaults.standard.set(nil, forKey: "currentCity")
        UserDefaults.standard.synchronize();
    }
}


