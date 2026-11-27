package org.agro.ledger.service;

import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.agro.ledger.client.AuditHubClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuditPublisher {

  private final KafkaTemplate<String, Map<String, Object>> kafka;
  private final AuditHubClient auditHub;

  @Value("${ledger.audit.topic}")
  private String topic;

  public void entriesSaved(String actor, String agronomist, int days) {
    publish(Map.of("type", "ENTRIES_SAVED", "actor", actor, "agronomist", agronomist, "days", days, "at", Instant.now().toString()));
  }

  public void templateChanged(String actor, long templateId, String action) {
    publish(Map.of("type", "TEMPLATE_" + action, "actor", actor, "templateId", templateId, "at", Instant.now().toString()));
  }

  private void publish(Map<String, Object> event) {
    try {
      kafka.send(topic, (String) event.get("actor"), event).get();
    } catch (Exception e) {
      log.warn("broker unavailable, audit goes over HTTP: {}", e.getMessage());
      auditHub.send(event);
    }
  }
}
