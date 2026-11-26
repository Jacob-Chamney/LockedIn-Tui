part of 'core_store.dart';

extension CoreStoreKnowledge on CoreStore {
  /// Search the unified Knowledge index (`knowledge.search`).
  ///
  /// [query] is the text the user typed; an empty or whitespace-only query
  /// **clears** the visible hits and returns to the tree without a request, so
  /// clearing the box never costs a round trip. [scope] is `all`, `school`,
  /// `skills` or `work`; an omitted or blank value keeps [knowledgeScope].
  ///
  /// A stale answer is dropped: every request takes a ticket and only the
  /// newest one may replace [knowledgeHits]. A failure is recorded once in
  /// [knowledgeError] and the previous hits stay on screen; the method never
  /// throws, so the page shows the core's own message with a Retry.
  Future<void> searchKnowledge(String query, {String? scope}) async {
    final text = query.trim();
    final requested = scope?.trim() ?? '';
    final target = requested.isEmpty ? knowledgeScope : requested;
    final ticket = ++_knowledgeTicket;
    // `knowledgeQuery` is what the visible hits answer, so it is assigned with
    // them below, not here: a failed search used to relabel the previous rows.
    knowledgeScope = target;
    knowledgeError = null;
    if (text.isEmpty) {
      // An empty query is the tree: no request, no loading state, no error. The
      // result set is gone with it, so the reader has no ordering left to walk —
      // and the query goes too, because `selectKnowledgeScope` reads it to decide
      // between a search and a tree reload.
      knowledgeQuery = '';
      knowledgeHits = const [];
      knowledgeHitOrder = const [];
      knowledgeHitIndex = null;
      _knowledgeSearching = false;
      _syncKnowledgeLoading();
      notifyListeners();
      return;
    }
    _knowledgeSearching = true;
    _syncKnowledgeLoading();
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.knowledgeSearch, {
        'query': text,
        'scope': target,
      });
      if (ticket != _knowledgeTicket) return;
      knowledgeQuery = text;
      final raw = json['hits'];
      knowledgeHits = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      KnowledgeHit.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      // One ordering per reply: the reader walks these ids, so a new result set
      // replaces the list a document opened from the previous one used.
      knowledgeHitOrder = [for (final hit in knowledgeHits) hit.id];
      final at = knowledgeHitOrder.indexOf(knowledgeDocumentId ?? '');
      knowledgeHitIndex = at >= 0 ? at : null;
    } catch (failure) {
      if (ticket != _knowledgeTicket) return;
      knowledgeError = _messageOf(failure);
    } finally {
      if (ticket == _knowledgeTicket) {
        _knowledgeSearching = false;
        _syncKnowledgeLoading();
        notifyListeners();
      }
    }
  }

  /// Read the Knowledge topic tree (`knowledge.tree`).
  ///
  /// [scope] is `all`, `school`, `skills` or `work`; an omitted or blank value
  /// keeps [knowledgeScope]. The tree only covers the two vaults, so a `work`
  /// scope is kept in [knowledgeScope] and the tree is read with `all`: the
  /// page says work items appear in search instead of showing an empty tree.
  /// The core knows the tree; the shell only groups and renders it. A failure is
  /// recorded once in [knowledgeError] and the previous [knowledgeGroups] stay
  /// on screen, so the page never claims an empty vault because one read failed.
  Future<void> loadKnowledgeTree({String? scope}) async {
    final requested = scope?.trim() ?? '';
    final target = requested.isEmpty ? knowledgeScope : requested;
    final ticket = ++_knowledgeTreeTicket;
    knowledgeScope = target;
    _knowledgeTreeLoading = true;
    _syncKnowledgeLoading();
    knowledgeError = null;
    notifyListeners();
    try {
      final side = target == 'work' ? 'all' : target;
      final json = await _connection.call(CoreMethod.knowledgeTree, {
        'side': side,
      });
      if (ticket != _knowledgeTreeTicket) return;
      final raw = json['groups'];
      knowledgeGroups = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (group) =>
                      KnowledgeGroup.fromJson(Map<String, dynamic>.from(group)),
                )
                .toList()
          : const [];
    } catch (failure) {
      if (ticket != _knowledgeTreeTicket) return;
      knowledgeError = _messageOf(failure);
    } finally {
      if (ticket == _knowledgeTreeTicket) {
        _knowledgeTreeLoading = false;
        _syncKnowledgeLoading();
        notifyListeners();
      }
    }
  }

  /// Read one Knowledge item's body (`knowledge.read`).
  ///
  /// [id] is a hit id (`note:…`, `memory:…`, `source:…`, `project:…`) or the
  /// `note:<workspace path>` id a tree row maps to — never a filesystem path the
  /// shell may open. The core resolves it, confines the read to the workspace and
  /// returns the row plus its body.
  ///
  /// The reader opens while the call is in flight and stays open on failure so
  /// one message with a Retry is visible; a success replaces [knowledgeDocument]
  /// with the core's own text. A stale answer for an item the user already left
  /// is dropped, and this method never throws.
  Future<void> readKnowledge(String id) async {
    final target = id.trim();
    if (target.isEmpty) return;
    final ticket = ++_knowledgeReadTicket;
    knowledgeDocumentId = target;
    // Only a search result set has an ordering to walk; a tree note (a bare
    // workspace path) is not a member of one, so it reports no position.
    final at = knowledgeHitOrder.indexOf(target);
    knowledgeHitIndex = at >= 0 ? at : null;
    knowledgeDocumentLoading = true;
    knowledgeDocumentError = null;
    knowledgeDocument = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.knowledgeRead, {
        'id': target,
      });
      if (ticket != _knowledgeReadTicket) return;
      knowledgeDocument = KnowledgeDocument.fromJson(json);
    } catch (failure) {
      if (ticket != _knowledgeReadTicket) return;
      knowledgeDocumentError = _messageOf(failure);
    } finally {
      if (ticket == _knowledgeReadTicket) {
        knowledgeDocumentLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the Knowledge item that last failed.
  Future<void> retryKnowledgeDocument() async {
    final id = knowledgeDocumentId;
    if (id == null || knowledgeDocumentLoading) return;
    await readKnowledge(id);
  }

  /// Open the hit at [index] in [knowledgeHitOrder].
  ///
  /// The reader's `[`/`]` call this instead of re-running the search, so moving
  /// between hits never returns to the list. The index is clamped by the caller
  /// (the reader shows `first hit`/`last hit`), and an out-of-range index is a
  /// no-op here rather than a request for a hit that does not exist.
  Future<void> openKnowledgeHit(int index) async {
    if (index < 0 || index >= knowledgeHitOrder.length) return;
    await readKnowledge(knowledgeHitOrder[index]);
  }

  /// Change the Knowledge projection and re-run what the surface is showing.
  ///
  /// A query re-runs `knowledge.search` with the new scope; with no query the
  /// tree is reloaded, which sends `all` for a `work` scope because the tree
  /// only covers the two vaults. [knowledgeScope] stays the scope the user
  /// picked, so a surface switch keeps it and the page can explain the tree.
  /// An unknown scope keeps the current one rather than being forwarded.
  Future<void> selectKnowledgeScope(String scope) async {
    final target = scope.trim();
    if (!knowledgeScopeValues.contains(target)) return;
    knowledgeScope = target;
    final query = knowledgeQuery.trim();
    if (query.isEmpty) {
      await loadKnowledgeTree(scope: target);
    } else {
      await searchKnowledge(query, scope: target);
    }
  }

  /// Collapse the Knowledge reader back to the surface.
  ///
  /// The tree, hits and the page's own selection stay exactly as they were, so
  /// closing is one `Esc` and reopening is one `Enter`.
  void closeKnowledgeDocument() {
    if (!knowledgeDocumentOpen && knowledgeDocumentId == null) return;
    _clearKnowledgeDocument();
    notifyListeners();
  }

  void _clearKnowledgeDocument() {
    knowledgeDocument = null;
    knowledgeDocumentLoading = false;
    knowledgeDocumentError = null;
    knowledgeDocumentId = null;
    knowledgeHitIndex = null;
    _knowledgeReadTicket += 1;
  }
}
