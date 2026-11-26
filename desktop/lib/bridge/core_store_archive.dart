part of 'core_store.dart';

extension CoreStoreArchive on CoreStore {
  /// Read the archive picker (`archive.list`).
  ///
  /// This is the read half of the archive only: the core reports what is already
  /// archived on both sides of the wall and the shell never restores, deletes,
  /// exports or writes. Rows come from the configured backend, so the local
  /// `archive-index/*.json` files are a cache and never the truth.
  ///
  /// A failure is recorded once in [archiveError] and the previous [archiveRows]
  /// stay on screen; the method never throws, so the page shows the core's own
  /// message with a Retry instead of an empty archive.
  Future<void> refreshArchive() async {
    final ticket = ++_archiveTicket;
    archiveLoading = true;
    archiveError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.archiveList);
      if (ticket != _archiveTicket) return;
      final raw = json['rows'];
      archiveRows = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) => ArchiveRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
    } catch (failure) {
      if (ticket != _archiveTicket) return;
      archiveError = _messageOf(failure);
    } finally {
      if (ticket == _archiveTicket) {
        archiveLoading = false;
        notifyListeners();
      }
    }
  }

  /// Restore one archived item into the live workspace (`archive.restore`).
  ///
  /// The destination is configuration, never a parameter: the core moves the
  /// archived copy back through the same service the TUI uses. The folder
  /// backend restores **both** sides of the wall — a school row is a session,
  /// a skills row is a goal — so [side] decides which live list is re-read
  /// afterwards.
  ///
  /// On success the item is live again, so the archive list and that side's list
  /// are re-read: the archive no longer lists it and `session.list` (school) or
  /// `skill.list` (skills) reports it. A refusal rethrows the [RpcException]
  /// untouched, exactly like [archiveSession], so the page shows the core's own
  /// message inline and no row moves. A failed re-read after a confirmed move
  /// goes to [error] (like [removeSession]) so a successful restore is never
  /// dressed up as a failed action.
  Future<void> restoreArchive({
    required String id,
    required String side,
  }) async {
    await _connection.call(CoreMethod.archiveRestore, {'id': id, 'side': side});
    await refreshArchive();
    try {
      if (side.trim() == 'skills') {
        await refreshSkills();
      } else {
        await refreshSessions();
      }
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Delete one **archived** item (`archive.remove`).
  ///
  /// This removes the archive copy only: the live session or goal is owned by
  /// `session.remove`/the goal manager and is never touched by this path. The
  /// shell has already asked for a named confirmation; this executes the
  /// confirmed delete.
  ///
  /// On success the archive list is re-read and the matching live list is
  /// refreshed (school → [refreshSessions], skills → [refreshSkills]), so a
  /// deleted row disappears without inventing or removing a live item. A
  /// refusal rethrows the [RpcException] untouched for the page's inline
  /// message, and no row moves.
  Future<void> removeArchive({required String id, required String side}) async {
    await _connection.call(CoreMethod.archiveRemove, {'id': id, 'side': side});
    await refreshArchive();
    try {
      if (side.trim() == 'skills') {
        await refreshSkills();
      } else {
        await refreshSessions();
      }
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// One authenticated validation. A failure throws so the dialog can show the
  /// exact reason and stay open; nothing is saved on failure.
  Future<ProviderLink> linkProvider({
    required String providerId,
    required String key,
    String? baseUrl,
  }) async {
    final json = await _connection.call(CoreMethod.providerLink, {
      'providerId': providerId,
      'key': key,
      if (baseUrl != null && baseUrl.trim().isNotEmpty)
        'baseUrl': baseUrl.trim(),
    });
    final link = ProviderLink.fromJson(json);
    await refreshProviders();
    return link;
  }
}
