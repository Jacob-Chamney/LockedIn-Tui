import 'package:material_ui/material_ui.dart';

import '../../bridge/errors.dart';
import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// Links one provider key, then picks a chat model from the returned list.
///
/// The key is sent to [onLinkProvider] once and is never stored here: linking
/// and the final model choice are two separate core calls, and the dialog only
/// closes after the second one succeeds.
class ConnectModelDialog extends StatefulWidget {
  const ConnectModelDialog({
    super.key,
    required this.settings,
    required this.providers,
    required this.providersError,
    required this.onLoadProviders,
    required this.onLinkProvider,
    required this.onSaveSettings,
  });

  final SettingsView settings;
  final List<ProviderRow> providers;
  final String? providersError;
  final Future<List<ProviderRow>> Function()? onLoadProviders;
  final Future<ProviderLink> Function(
    String providerId,
    String key,
    String? baseUrl,
  )
  onLinkProvider;
  final Future<void> Function(Map<String, dynamic> patch) onSaveSettings;

  @override
  State<ConnectModelDialog> createState() => ConnectModelDialogState();
}

class ConnectModelDialogState extends State<ConnectModelDialog> {
  final _keyController = TextEditingController();
  late final TextEditingController _baseUrlController;
  late List<ProviderRow> _providers;
  late String? _providerId;
  bool _loadingProviders = false;
  bool _linking = false;
  bool _saving = false;
  String? _error;
  ProviderLink? _link;
  String? _model;

  @override
  void initState() {
    super.initState();
    _providers = List<ProviderRow>.of(widget.providers);
    _providerId = _defaultProviderId();
    _baseUrlController = TextEditingController(text: widget.settings.baseUrl);
    _keyController.addListener(_onKeyChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadProviders());
  }

  @override
  void dispose() {
    _keyController.dispose();
    _baseUrlController.dispose();
    super.dispose();
  }

  void _onKeyChanged() {
    if (mounted) setState(() {});
  }

  String? _defaultProviderId() {
    final model = widget.settings.chatModel.trim();
    final slash = model.indexOf('/');
    if (slash > 0) {
      final prefix = model.substring(0, slash);
      for (final provider in _providers) {
        if (provider.id == prefix) return provider.id;
      }
    }
    return _providers.isEmpty ? null : _providers.first.id;
  }

  ProviderRow? get _provider {
    for (final provider in _providers) {
      if (provider.id == _providerId) return provider;
    }
    return null;
  }

  bool get _isCustomProvider => _providerId == 'custom';

  bool get _canLink =>
      !_linking &&
      _providerId != null &&
      (_isCustomProvider || _keyController.text.trim().isNotEmpty);

  bool get _canSave => !_saving && _link != null && _model != null;

  Future<void> _loadProviders() async {
    final load = widget.onLoadProviders;
    if (load == null) return;
    if (mounted) setState(() => _loadingProviders = true);
    try {
      final fresh = await load();
      if (!mounted) return;
      setState(() {
        _providers = fresh;
        if (_providerId == null ||
            !_providers.any((provider) => provider.id == _providerId)) {
          _providerId = _defaultProviderId();
        }
      });
    } on RpcException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loadingProviders = false);
    }
  }

  void _chooseProvider(String id) {
    if (id == _providerId) return;
    setState(() {
      _providerId = id;
      _link = null;
      _model = null;
      _error = null;
    });
  }

  Future<void> _submitLink() async {
    final providerId = _providerId;
    if (providerId == null || !_canLink) return;
    final key = _keyController.text.trim();
    final baseUrl = providerId == 'custom'
        ? _baseUrlController.text.trim()
        : null;
    setState(() {
      _linking = true;
      _error = null;
    });
    try {
      final link = await widget.onLinkProvider(providerId, key, baseUrl);
      if (!mounted) return;
      setState(() {
        _link = link;
        _model = link.models.isEmpty ? null : link.models.first;
      });
    } on RpcException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _linking = false);
    }
  }

  Future<void> _save() async {
    final link = _link;
    final model = _model;
    if (link == null || model == null || !_canSave) return;
    final providerId = link.providerId.trim().isEmpty
        ? (_providerId ?? '')
        : link.providerId;
    final custom = providerId == 'custom' || _isCustomProvider;
    final patch = <String, dynamic>{
      'models': <String, dynamic>{
        'chat': '$providerId/$model',
        if (custom) 'base_url': _baseUrlController.text.trim(),
      },
    };
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSaveSettings(patch);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _error = userMessage(failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = _provider;
    return AlertDialog(
      backgroundColor: LockedInColors.surface,
      title: const Text('connect a model'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'The key is sent once to the core and stored in the OS '
                'keychain. It is never read back here.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 12),
              _providerList(),
              if (_loadingProviders) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 8),
                    Text(
                      'loading providers…',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                      ),
                    ),
                  ],
                ),
              ],
              if (provider != null) ...[
                const SizedBox(height: 14),
                TextField(
                  key: const ValueKey('settings-provider-key'),
                  controller: _keyController,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: 'API key',
                    hintText: _isCustomProvider
                        ? 'optional for local endpoints'
                        : 'required',
                  ),
                  onSubmitted: (_) {
                    if (_canLink) _submitLink();
                  },
                ),
              ],
              if (_isCustomProvider) ...[
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('settings-provider-base-url'),
                  controller: _baseUrlController,
                  decoration: const InputDecoration(
                    labelText: 'base URL',
                    hintText: 'https://localhost:11434/v1',
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  key: const ValueKey('settings-dialog-error'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(color: LockedInColors.error),
                    borderRadius: BorderRadius.circular(Radii.control),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
              if (_link != null) ...[
                const SizedBox(height: 16),
                Text(
                  'choose a chat model',
                  style: TextStyle(
                    color: LockedInColors.secondary,
                    fontSize: TypeScale.label,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 4),
                if (_link!.models.isEmpty)
                  Text(
                    'No models returned for this key.',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  )
                else
                  for (final model in _link!.models) _modelRow(model),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          key: const ValueKey('settings-connect-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        OutlinedButton(
          key: const ValueKey('settings-link'),
          onPressed: _canLink ? _submitLink : null,
          child: _linking
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(_link == null ? 'Link' : 'Link again'),
        ),
        FilledButton(
          key: const ValueKey('settings-use-model'),
          onPressed: _canSave ? _save : null,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Use this model'),
        ),
      ],
    );
  }

  Widget _providerList() {
    final error = widget.providersError;
    if (_providers.isEmpty) {
      return Text(
        error != null && error.isNotEmpty
            ? error
            : 'No providers configured. Add one to config.toml first.',
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.label,
          height: 1.4,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (error != null && error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              error,
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: TypeScale.label,
                height: 1.3,
              ),
            ),
          ),
        for (final provider in _providers) _providerRow(provider),
      ],
    );
  }

  Widget _providerRow(ProviderRow provider) {
    final selected = provider.id == _providerId;
    return InkWell(
      key: ValueKey('settings-provider-${provider.id}'),
      onTap: () => _chooseProvider(provider.id),
      borderRadius: BorderRadius.circular(Radii.control),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 16,
              color: selected ? LockedInColors.primary : LockedInColors.muted,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    provider.label.isEmpty ? provider.id : provider.label,
                    style: TextStyle(
                      color: LockedInColors.foreground,
                      fontSize: TypeScale.body,
                    ),
                  ),
                  if (provider.note.isNotEmpty)
                    Text(
                      provider.note,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                        height: 1.3,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
              decoration: BoxDecoration(
                border: Border.all(
                  color: provider.linked
                      ? LockedInColors.success
                      : LockedInColors.line,
                ),
                borderRadius: BorderRadius.circular(Radii.control),
              ),
              child: Text(
                provider.linked ? 'linked' : 'not linked',
                style: TextStyle(
                  color: provider.linked
                      ? LockedInColors.success
                      : LockedInColors.muted,
                  fontSize: TypeScale.micro,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _modelRow(String model) {
    final selected = model == _model;
    return InkWell(
      key: ValueKey('settings-model-$model'),
      onTap: () => setState(() => _model = model),
      borderRadius: BorderRadius.circular(Radii.control),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 16,
              color: selected ? LockedInColors.primary : LockedInColors.muted,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                model,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.body,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
