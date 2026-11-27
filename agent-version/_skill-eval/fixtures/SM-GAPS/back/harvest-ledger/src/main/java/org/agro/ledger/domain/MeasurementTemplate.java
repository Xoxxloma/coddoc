package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "measurement_template", schema = "ledger")
public class MeasurementTemplate {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private String name;

  @Column(name = "owner_number", nullable = false)
  private String ownerNumber;

  @Column(name = "created_at", nullable = false)
  private LocalDateTime createdAt = LocalDateTime.now();

  @ManyToMany
  @JoinTable(name = "template_crop", schema = "ledger",
      joinColumns = @JoinColumn(name = "template_id"),
      inverseJoinColumns = @JoinColumn(name = "crop_id"))
  private Set<Crop> crops = new HashSet<>();
}
