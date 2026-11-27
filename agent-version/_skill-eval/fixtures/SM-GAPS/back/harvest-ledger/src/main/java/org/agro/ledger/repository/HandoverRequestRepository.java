package org.agro.ledger.repository;

import java.time.LocalDateTime;
import java.util.List;
import org.agro.ledger.domain.HandoverRequest;
import org.agro.ledger.domain.HandoverStatus;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HandoverRequestRepository extends JpaRepository<HandoverRequest, Long> {
  boolean existsByFromHeadAndStatus(String fromHead, HandoverStatus status);

  List<HandoverRequest> findByStatusAndCreatedAtBefore(HandoverStatus status, LocalDateTime before);
}
