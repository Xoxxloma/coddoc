package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.HandoverApi;
import org.agro.ledger.api.model.Decision;
import org.agro.ledger.api.model.HandoverRequest;
import org.agro.ledger.api.model.Person;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.HandoverService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class HandoverApiController implements HandoverApi {

  private final HandoverService service;

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<List<Person>> listSupervisors() {
    return ResponseEntity.ok(service.supervisors().stream().map(p -> {
      Person d = new Person();
      d.setNumber(p.number());
      d.setFullName(p.fullName());
      return d;
    }).toList());
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> requestHandover(HandoverRequest body) {
    service.request(CurrentUser.number(), body.getToHead());
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<HandoverRequest> getHandover(Long id) {
    org.agro.ledger.domain.HandoverRequest r = service.get(id);
    HandoverRequest d = new HandoverRequest();
    d.setId(r.getId());
    d.setFromHead(r.getFromHead());
    d.setToHead(r.getToHead());
    d.setStatus(r.getStatus().name());
    return ResponseEntity.ok(d);
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> decideHandover(Long id, Decision decision) {
    service.decide(CurrentUser.number(), id, decision);
    return ResponseEntity.noContent().build();
  }
}
