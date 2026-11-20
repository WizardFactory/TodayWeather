import GoogleMobileAds
import SwiftUI
import TWDomain

/// The SDK owns hit testing, the media player and AdChoices. The card's padding is outside its registered assets.
struct ForecastCreativeHost: UIViewRepresentable {
    let ad: NativeAd
    let stacked: Bool
    let theme: Theme
    let locale: Locale
    @Environment(\.dynamicTypeSize) private var dynamicType

    func makeUIView(context: Context) -> ForecastCreativeView {
        ForecastCreativeView()
    }

    func updateUIView(_ view: ForecastCreativeView, context: Context) {
        view.configure(ad, stacked: stacked, accessible: dynamicType.isAccessibilitySize,
                       theme: theme, locale: locale)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ForecastCreativeView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.systemLayoutSizeFitting(CGSize(width: width, height: 0),
                                              withHorizontalFittingPriority: .required,
                                              verticalFittingPriority: .fittingSizeLevel)
    }
}

final class ForecastCreativeView: NativeAdView {
    private let stack = UIStackView()
    private let assets = UIStackView()
    private let details = UIStackView()
    private let disclosure = UILabel()
    private let headline = UILabel()
    private let advertiser = UILabel()
    private let copy = UILabel()
    private let action = UILabel()
    private let icon = UIImageView()
    private let media = MediaView()
    private let choices = AdChoicesView()
    private var mediaWidth: NSLayoutConstraint!
    private var mediaHeight: NSLayoutConstraint!

    override init(frame: CGRect) {
        super.init(frame: frame)
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: layoutMarginsGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: layoutMarginsGuide.bottomAnchor)
        ])

        let header = UIStackView(arrangedSubviews: [disclosure, UIView(), choices])
        header.alignment = .center
        choices.widthAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
        choices.heightAnchor.constraint(greaterThanOrEqualToConstant: 18).isActive = true
        stack.addArrangedSubview(header)
        assets.spacing = 8
        assets.addArrangedSubview(media)
        assets.addArrangedSubview(details)
        stack.addArrangedSubview(assets)
        mediaWidth = media.widthAnchor.constraint(equalToConstant: 120)
        mediaHeight = media.heightAnchor.constraint(equalToConstant: 120)
        mediaHeight.isActive = true
        media.contentMode = .scaleAspectFit

        let title = UIStackView(arrangedSubviews: [icon, headline])
        title.alignment = .center
        title.spacing = 6
        icon.contentMode = .scaleAspectFit
        icon.widthAnchor.constraint(equalToConstant: 28).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 28).isActive = true
        details.axis = .vertical
        details.spacing = 3
        for view in [title, advertiser, copy, action] { details.addArrangedSubview(view) }
        for (label, style) in [(disclosure, UIFont.TextStyle.caption2), (headline, .headline),
                               (advertiser, .caption1), (copy, .subheadline), (action, .callout)] {
            label.numberOfLines = 0
            label.font = .preferredFont(forTextStyle: style)
            label.adjustsFontForContentSizeCategory = true
            label.setContentCompressionResistancePriority(.required, for: .vertical)
        }
        action.textColor = .link
        action.accessibilityTraits.insert(.button)
        self.headlineView = headline
        self.bodyView = copy
        self.callToActionView = action
        self.advertiserView = advertiser
        self.iconView = icon
        self.mediaView = media
        self.adChoicesView = choices
        layer.cornerRadius = 10
        clipsToBounds = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configure(_ ad: NativeAd, stacked: Bool, accessible: Bool, theme: Theme, locale: Locale) {
        overrideUserInterfaceStyle = theme == .dark ? .dark : .light
        backgroundColor = .secondarySystemGroupedBackground
        let padding: CGFloat = stacked ? 12 : 8
        directionalLayoutMargins = .init(top: padding, leading: padding, bottom: padding, trailing: padding)
        let vertical = stacked || accessible
        assets.axis = vertical ? .vertical : .horizontal
        assets.alignment = vertical ? .fill : .center
        mediaWidth.isActive = !vertical
        mediaHeight.constant = stacked ? 180 : 120
        disclosure.text = Self.disclosure(locale)
        for (label, text) in [(headline, ad.headline), (advertiser, ad.advertiser), (copy, ad.body),
                              (action, ad.callToAction)] {
            label.text = text
            label.isHidden = text?.isEmpty != false
        }
        icon.image = ad.icon?.image
        icon.isHidden = icon.image == nil
        if nativeAd !== ad {
            media.mediaContent = ad.mediaContent
            ad.rootViewController = GoogleAdsPlatform.topViewController()
            nativeAd = ad
        }
    }

    static func disclosure(_ locale: Locale) -> String {
        switch locale.language.languageCode?.identifier {
        case "ko": "광고"
        case "ja": "広告"
        case "zh": locale.language.script?.identifier == "Hant" ? "廣告" : "广告"
        case "de": "Anzeige"
        default: "Ad"
        }
    }
}
