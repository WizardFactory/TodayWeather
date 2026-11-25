import Foundation

/// The texts of the header search and the unsaved place (#3180, #3097), which the Cordova catalogs do not have: per
/// catalog code, the same wording as the Android app's `link_strings.xml`, English otherwise.
struct LinkTexts: Equatable {
    /// The star's label (`link_add_favorite`).
    let addFavorite: String
    /// The short notice after the star saved the place (`link_added_favorite`).
    let addedFavorite: String
    /// The search button's label (`header_search`).
    let search: String

    static func of(_ catalog: String) -> LinkTexts {
        switch catalog {
        case "ko": LinkTexts(addFavorite: "즐겨찾기 추가", addedFavorite: "즐겨찾기에 추가했습니다", search: "지역 검색")
        case "ja": LinkTexts(addFavorite: "お気に入りに追加", addedFavorite: "お気に入りに追加しました", search: "地域を検索")
        case "de": LinkTexts(addFavorite: "Zu Favoriten hinzufügen", addedFavorite: "Zu den Favoriten hinzugefügt", search: "Orte suchen")
        case "zh-CN": LinkTexts(addFavorite: "添加到收藏", addedFavorite: "已添加到收藏", search: "搜索地点")
        case "zh-TW": LinkTexts(addFavorite: "加入收藏", addedFavorite: "已加入收藏", search: "搜尋地點")
        default: LinkTexts(addFavorite: "Add to favorites", addedFavorite: "Added to favorites", search: "Search locations")
        }
    }
}
