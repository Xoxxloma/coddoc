package org.agro.ledger.web;

import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.EntriesApi;
import org.agro.ledger.api.model.Decision;
import org.agro.ledger.api.model.EntryDay;
import org.agro.ledger.api.model.EntrySave;
import org.agro.ledger.api.model.WeekStatus;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.EntryService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

/** Реализация интерфейса, который openapi-generator собирает из openapi/harvest-ledger.yaml. */
@RestController
@RequiredArgsConstructor
public class EntriesApiController implements EntriesApi {

  private final EntryService service;
  private final EntryMapper mapper;

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<List<EntryDay>> listOwnEntries(LocalDate from, LocalDate to) {
    return ResponseEntity.ok(mapper.days(service.list(CurrentUser.number(), from, to), from, to));
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> saveEntries(List<EntrySave> body) {
    service.save(CurrentUser.number(), body);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> submitWeek(LocalDate weekStart) {
    service.submit(CurrentUser.number(), weekStart);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<WeekStatus> getWeekStatus(LocalDate weekStart) {
    return ResponseEntity.ok(service.weekStatus(CurrentUser.number(), weekStart));
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> deleteDraftDay(LocalDate date) {
    service.deleteDraftDay(CurrentUser.number(), date);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<List<EntryDay>> listAgronomistEntries(String agronomist, LocalDate from, LocalDate to) {
    return ResponseEntity.ok(mapper.days(service.list(agronomist, from, to), from, to));
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> decideEntries(String agronomist, Decision decision) {
    service.decide(CurrentUser.number(), agronomist, decision);
    return ResponseEntity.noContent().build();
  }
}
