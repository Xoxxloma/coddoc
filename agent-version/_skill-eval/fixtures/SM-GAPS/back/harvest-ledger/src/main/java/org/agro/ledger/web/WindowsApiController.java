package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.WindowsApi;
import org.agro.ledger.api.model.Decision;
import org.agro.ledger.api.model.Window;
import org.agro.ledger.api.model.WindowRequest;
import org.agro.ledger.domain.WeekWindow;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.WindowService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class WindowsApiController implements WindowsApi {

  private final WindowService service;

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> requestWindow(WindowRequest body) {
    service.request(CurrentUser.number(), body);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<List<Window>> listOwnWindows() {
    return ResponseEntity.ok(service.own(CurrentUser.number()).stream().map(WindowsApiController::dto).toList());
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<List<Window>> listPendingWindows() {
    return ResponseEntity.ok(service.pending().stream().map(WindowsApiController::dto).toList());
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> cancelWindow(Long id) {
    service.cancel(CurrentUser.number(), id);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> decideWindow(Long id, Decision decision) {
    service.decide(id, decision);
    return ResponseEntity.noContent().build();
  }

  private static Window dto(WeekWindow w) {
    Window d = new Window();
    d.setId(w.getId());
    d.setAgronomist(w.getAgronomistNumber());
    d.setWeekStart(w.getWeekStart());
    d.setReason(w.getReason());
    d.setStatus(w.getStatus().name());
    return d;
  }
}
