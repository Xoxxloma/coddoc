package org.agro.ledger.service;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Decision;
import org.agro.ledger.client.StaffProfileClient;
import org.agro.ledger.domain.HandoverRequest;
import org.agro.ledger.domain.HandoverStatus;
import org.agro.ledger.repository.HandoverRequestRepository;
import org.agro.ledger.repository.TemplateRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class HandoverService {

  private final HandoverRequestRepository requests;
  private final TemplateRepository templates;
  private final StaffProfileClient staff;
  private final MailService mail;

  public List<StaffProfileClient.Profile> supervisors() {
    return staff.byRole("HEAD_AGRONOMIST");
  }

  /** Один открытый запрос на главного агронома; себе передать нельзя. */
  @Transactional
  public HandoverRequest request(String fromHead, String toHead) {
    if (fromHead.equals(toHead)) {
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "same head");
    }
    if (requests.existsByFromHeadAndStatus(fromHead, HandoverStatus.REQUESTED)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "open request exists");
    }
    HandoverRequest r = new HandoverRequest();
    r.setFromHead(fromHead);
    r.setToHead(toHead);
    requests.save(r);
    mail.handoverRequested(fromHead, toHead);
    return r;
  }

  public HandoverRequest get(long id) {
    return requests.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
  }

  /** При одобрении все шаблоны прежнего главного агронома переходят новому вместе с назначениями. */
  @Transactional
  public void decide(String methodist, long id, Decision decision) {
    HandoverRequest r = get(id);
    if (r.getStatus() != HandoverStatus.REQUESTED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "already decided");
    }
    r.setDecidedBy(methodist);
    if (decision.getApprove()) {
      r.setStatus(HandoverStatus.APPROVED);
      templates.findByOwnerNumber(r.getFromHead()).forEach(t -> t.setOwnerNumber(r.getToHead()));
    } else {
      r.setStatus(HandoverStatus.REJECTED);
    }
  }
}
