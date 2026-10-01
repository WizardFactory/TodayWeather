require 'minitest/autorun'
require 'tmpdir'

class FastlaneHarness
  attr_reader :lanes, :calls, :export_directories
  attr_accessor :fail_action
  def initialize
    @lanes, @calls, @export_directories = {}, [], []
  end
  def desc(*) ; end
  def lane(name, &block) ; @lanes[name] = block ; end
  def platform(*) ; yield ; end
  def method_missing(name, *args)
    @calls << [name, args]
    raise IOError, 'fixture failure' if name == @fail_action
    if name == :sh && args.include?('--metadata_path')
      output = args[args.index('--metadata_path') + 1]
      if args.include?('supply') && File.exist?(output)
        raise IOError, 'Supply skips an existing output directory'
      end
      FileUtils.mkdir_p(File.join(output, 'ko'))
      File.write(File.join(output, 'ko/description.txt'), 'fixture metadata')
      @export_directories << output
    end
    return { token: 'fixture' } if name == :app_store_connect_api_key
  end
end

class StoreReleaseTest < Minitest::Test
  def setup
    @saved = ENV.to_h
    @dir = Dir.mktmpdir('tw-store')
    @key = File.join(@dir, 'key.json')
    File.write(@key, '{}')
    @ipa = File.join(@dir, 'app.ipa')
    @aab = File.join(@dir, 'app.aab')
    File.write(@ipa, 'fixture'); File.write(@aab, 'fixture')
    %w[TW_PLAY_JSON_KEY TW_ASC_KEY_ID TW_ASC_ISSUER_ID TW_ASC_KEY_FILE].each { |k| ENV.delete(k) }
    @harness = FastlaneHarness.new
    @harness.instance_eval(File.read(File.expand_path('../fastlane/Fastfile', __dir__)), File.expand_path('../fastlane/Fastfile', __dir__))
  end
  def teardown
    ENV.replace(@saved)
    @harness.export_directories.each { |output| FileUtils.remove_entry(output) } if @harness
    FileUtils.remove_entry(@dir)
  end
  def apple_auth
    ENV['TW_ASC_KEY_ID'] = 'fixture-id'
    ENV['TW_ASC_ISSUER_ID'] = 'fixture-issuer'
    ENV['TW_ASC_KEY_FILE'] = @key
  end
  def test_missing_credentials_fail_before_store_call
    assert_raises(ArgumentError) { @harness.lanes[:internal].call(aab: @aab) }
    assert_empty @harness.calls
    assert_raises(ArgumentError) { @harness.lanes[:upload_beta].call(ipa: @ipa) }
    assert_empty @harness.calls
  end
  def test_missing_artifact_fails_without_upload
    ENV['TW_PLAY_JSON_KEY'] = @key
    assert_raises(ArgumentError) { @harness.lanes[:internal].call(aab: File.join(@dir, 'missing')) }
    assert_empty @harness.calls
  end
  def test_internal_upload_cannot_promote_to_production_or_change_listing
    ENV['TW_PLAY_JSON_KEY'] = @key
    @harness.lanes[:internal].call(aab: @aab, track: 'production')
    opts = @harness.calls.find { |name, _| name == :upload_to_play_store }[1][0]
    assert_equal 'internal', opts[:track]
    assert_equal 'draft', opts[:release_status]
    assert opts[:changes_not_sent_for_review]
    assert opts[:skip_upload_metadata]
    assert opts[:skip_upload_images]
    assert opts[:skip_upload_screenshots]
    assert opts[:skip_upload_changelogs]
  end
  def test_testflight_does_not_auto_distribute_or_submit_external_review
    apple_auth
    @harness.lanes[:upload_beta].call(ipa: @ipa)
    opts = @harness.calls.find { |name, _| name == :upload_to_testflight }[1][0]
    refute opts[:distribute_external]
    assert opts[:skip_submission]
    assert opts[:skip_waiting_for_build_processing]
  end
  def test_apple_export_requires_api_auth_and_outputs_to_ignored_reports
    apple_auth
    @harness.lanes[:export_ios].call
    args = @harness.calls.find { |name, _| name == :sh }[1]
    assert_includes args, '--api_key_path'
    assert_includes args, '--app_identifier'
    assert args.any? { |s| s.is_a?(String) && s.include?('/reports/store-export/ios') }
  end
  def test_temporary_apple_key_is_removed_after_export_failure
    apple_auth
    @harness.fail_action = :sh
    out, _ = capture_io do
      assert_raises(IOError) { @harness.lanes[:export_ios].call }
    end
    args = @harness.calls.find { |name, _| name == :sh }[1]
    key_file = args[args.index('--api_key_path') + 1]
    refute File.exist?(key_file)
    assert File.exist?(@key)
    events = out.lines.map { |line| JSON.parse(line) }
    assert_equal ['started', 'failed'], events.map { |event| event['result'] }
    assert_equal 1, events.map { |event| event['run_id'] }.uniq.length
    assert_equal 'IOError', events.last['cause']
    refute_includes out, 'fixture-id'
  end

  def test_play_export_fetches_into_a_new_directory_instead_of_silently_skipping
    ENV['TW_PLAY_JSON_KEY'] = @key
    @harness.lanes[:export_play].call
    args = @harness.calls.find { |name, _| name == :sh }[1]
    output = args[args.index('--metadata_path') + 1]
    assert File.file?(File.join(output, 'ko/description.txt'))
  end
  def test_listing_validation_cannot_commit_or_upload_binary_images_or_notes
    ENV['TW_PLAY_JSON_KEY'] = @key
    @harness.lanes[:validate_listing].call
    options = @harness.calls.find { |name, _| name == :upload_to_play_store }[1][0]
    assert options[:validate_only]
    assert options[:skip_upload_apk]
    assert options[:skip_upload_aab]
    assert options[:skip_upload_images]
    assert options[:skip_upload_screenshots]
    assert options[:skip_upload_changelogs]
    refute options[:skip_upload_metadata]
    assert_equal 'production', options[:track]
    assert_nil options[:track_promote_to]
    assert_nil options[:rollout]
  end
end
